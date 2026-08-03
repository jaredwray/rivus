import { randomUUID } from 'node:crypto';
import {
	type AccountId,
	type AgentThread,
	type AgentThreadId,
	type Customer,
	type CustomerId,
	emailSchema,
	normalizePhone,
} from '@rivus/core';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { isSeedingEnabled } from '../config';
import {
	errorResponseSchema,
	idParamsSchema,
	testerChannelSchema,
	testerSessionDetailResponseSchema,
	testerSessionListResponseSchema,
	testerSessionResponseSchema,
	testerSpeechResponseSchema,
	testerTranscriptionResponseSchema,
	testerTurnResponseSchema,
	testerVoiceResponseSchema,
} from '../http-schemas';
import { toTesterSession } from '../presenters';
import { ConflictError } from '../repositories/errors';
import { defaultCapabilities } from '../services/agent/capabilities';
import type { InboundAgentMessage } from '../services/agent/channel';
import { handleInboundAgentMessage } from '../services/agent/orchestrator';
import { createTesterChannel, type TesterChannel } from '../services/agent/tester';
import { runVoiceTurn } from './agent-voice-shared';

/**
 * The Agent Tester: a development-only, staff-only chat harness for the
 * customer-facing agent. Each endpoint drives the SAME pipeline a real inbound
 * message does — the shared orchestrator, the registered capabilities, the
 * channel's own renderer, the thread's machine state, and the inbox transcript —
 * with only the transport swapped for a capturing one (see
 * `services/agent/tester.ts`), so a turn is exercised end to end without a
 * message ever leaving the building.
 *
 * A `phone` session is a simulated voice call: staff type what the caller says
 * and get back the line Rivus would speak, plus where that left the call. Voice
 * has no asynchronous transport to capture — its reply *is* the webhook's
 * response — so those turns run through the shared voice core the Twilio and
 * Plivo routes use, making the tester a third edge onto it rather than a
 * lookalike that could drift.
 *
 * A call can also be *held* rather than typed: the speech routes below transcribe
 * what staff say into the microphone and synthesize what Rivus says back, so the
 * copy can be judged by ear — which is the only way a spoken line is really
 * judged. They are strictly an input/output convenience around the same turn
 * endpoint, so a session driven by voice produces exactly the transcript a typed
 * one does.
 *
 * A "session" is not a new entity: it *is* the existing `AgentThread` for a
 * (account, channel, contactAddress) plus the inbox `Conversation` holding its
 * transcript. That is what makes the tester honest — staff drive exactly the
 * records a real customer would — and what makes delete a true reset: dropping
 * both is dropping everything the agent remembers about the contact.
 *
 * Gated like the seeder (`isSeedingEnabled`): registered on a local dev API and
 * on the deployed development environment, never in production, where the routes
 * simply do not exist (404). Behind that, every route is staff-only.
 */

/** Body of "open a tester session": identify the contact by CRM customer *or* raw address. */
const createTesterSessionSchema = z
	.object({
		channel: testerChannelSchema,
		/** An existing CRM customer to write in as; their email/phone becomes the address. */
		customerId: z
			.string()
			.trim()
			.max(128, { error: 'Customer must be 128 characters or fewer.' })
			.default(''),
		/** A raw address to write in from, for testing a contact who isn't a customer. */
		contactAddress: z
			.string()
			.trim()
			.max(254, { error: 'Contact address must be 254 characters or fewer.' })
			.default(''),
		/** Display name for a raw contact; defaults to their address. */
		contactName: z
			.string()
			.trim()
			.max(120, { error: 'Contact name must be 120 characters or fewer.' })
			.default(''),
		/** Email-only subject the thread starts under. */
		subject: z
			.string()
			.trim()
			.max(200, { error: 'Subject must be 200 characters or fewer.' })
			.default(''),
	})
	// One identity per session: a customer *or* a raw address, never both and
	// never neither — the address is what the whole thread is keyed on.
	.refine((body) => Boolean(body.customerId) !== Boolean(body.contactAddress), {
		error: 'Pick exactly one: an existing customer, or a contact address to write in from.',
	});

/** Body of "send a message as the customer" — one simulated inbound turn. */
const testerMessageSchema = z.object({
	text: z
		.string({ error: 'Message is required.' })
		.trim()
		.min(1, { error: 'Message is required.' })
		.max(4000, { error: 'Message must be 4000 characters or fewer.' }),
});

/** Body of "say this line out loud" — the reply the caller would have heard. */
const testerSpeechSchema = z.object({
	text: z
		.string({ error: 'Text is required.' })
		.trim()
		.min(1, { error: 'Text is required.' })
		.max(4000, { error: 'Text must be 4000 characters or fewer.' }),
});

/**
 * How much base64 audio one utterance may carry. The app stops recording at 60
 * seconds, which is a few hundred KB of Opus — this bound only exists so a
 * malformed or hostile client can't stream an unbounded body at the transcriber.
 */
const MAX_UTTERANCE_BASE64 = 8 * 1024 * 1024;

/** Body of "here's what the caller just said" — one recorded utterance. */
const testerTranscribeSchema = z.object({
	audio: z
		.string({ error: 'Audio is required.' })
		.min(1, { error: 'Audio is required.' })
		.max(MAX_UTTERANCE_BASE64, { error: 'That recording is too long — keep it under a minute.' }),
});

/** The contact a session is opened for, resolved from either identifier. */
interface ResolvedContact {
	/** Canonical channel address: a lower-cased email, or an E.164 phone. */
	address: string;
	/** Display name for the conversation. */
	name: string;
	/** The CRM customer behind the address, when there is one. */
	customer: Customer | null;
}

export const agentTesterRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();
	// Same gate as the seeder in routes/admin.ts: local dev and the deployed
	// development environment register the routes; production never does.
	if (!isSeedingEnabled(app.deps.config)) {
		return;
	}
	const {
		accounts,
		agentThreads,
		conversations,
		customers,
		config,
		jobs,
		faqs,
		faqAnswer,
		memberships,
		notifier,
		testerVoice,
	} = app.deps;
	const orchestratorDeps = {
		config,
		jobs,
		conversations,
		agentThreads,
		faqs,
		faqAnswer,
		memberships,
		notifier,
	};
	// Built once, like every channel route does: the registry is the agent's
	// feature set, identical to the one a real inbound message dispatches through.
	const capabilities = defaultCapabilities();

	/** The account the caller's session is scoped to. */
	async function requireAccount(accountId: AccountId) {
		const account = await accounts.findById(accountId);
		if (!account) {
			throw app.httpErrors.notFound('Account not found');
		}
		return account;
	}

	/**
	 * The thread behind a session id. A thread from another account and an unknown
	 * id are uniformly "not found" — the tester never reveals that someone else's
	 * session exists.
	 */
	async function requireSession(accountId: AccountId, id: string): Promise<AgentThread> {
		const thread = await agentThreads.findById(accountId, id as AgentThreadId);
		if (!thread) {
			throw app.httpErrors.notFound('Tester session not found');
		}
		return thread;
	}

	/** Resolve the contact from a CRM customer: their address on the chosen channel. */
	async function contactFromCustomer(
		accountId: AccountId,
		customerId: string,
		channel: TesterChannel,
	): Promise<ResolvedContact> {
		const customer = await customers.findById(accountId, customerId as CustomerId);
		if (!customer) {
			throw app.httpErrors.notFound('Customer not found');
		}
		if (channel === 'email') {
			const address = customer.email.trim().toLowerCase();
			if (address === '') {
				throw app.httpErrors.badRequest('This customer has no email address on file.');
			}
			return { address, name: customer.name, customer };
		}
		// Phone-shaped channels talk E.164; the CRM stores free text.
		const address = normalizePhone(customer.phone);
		if (address === '') {
			throw app.httpErrors.badRequest(
				'This customer has no usable phone number on file — add one like (555) 123-4567 first.',
			);
		}
		return { address, name: customer.name, customer };
	}

	/**
	 * Resolve the contact from a raw address, canonicalizing it the way the
	 * channel's inbound edge would, then looking it up in that channel's identity
	 * space so a contact who *is* a customer links immediately.
	 */
	async function contactFromAddress(
		accountId: AccountId,
		rawAddress: string,
		contactName: string,
		channel: TesterChannel,
	): Promise<ResolvedContact> {
		let address: string;
		let customer: Customer | null;
		if (channel === 'email') {
			const parsed = emailSchema.safeParse(rawAddress);
			if (!parsed.success) {
				throw app.httpErrors.badRequest('Enter a valid email address.');
			}
			address = parsed.data;
			customer = await customers.findByEmail(accountId, address);
		} else {
			address = normalizePhone(rawAddress);
			if (address === '') {
				// One message for every phone-shaped channel, calls included.
				throw app.httpErrors.badRequest(
					'Enter a phone number Rivus can reach, like (555) 123-4567.',
				);
			}
			customer = await customers.findByPhone(accountId, address);
		}
		return { address, name: contactName || address, customer };
	}

	/** A session's two halves, for the responses that carry the transcript. */
	async function loadDetail(accountId: AccountId, thread: AgentThread) {
		const conversation = await conversations.findById(accountId, thread.conversationId);
		const messages = (await conversations.listMessages(accountId, thread.conversationId)) ?? [];
		return { session: toTesterSession(thread, conversation), messages };
	}

	app.get(
		'/sessions',
		{
			onRequest: [fastify.authenticate, fastify.requireStaff],
			schema: {
				tags: ['admin'],
				summary: 'List the agent tester sessions (development only, Rivus staff only)',
				description:
					'Every agent thread on the current account — one per (channel, contact), ' +
					'phone calls included — joined with the inbox conversation carrying its ' +
					'transcript, most recently active first. Unpaginated: a test account holds a ' +
					'handful of these.',
				security: [{ bearerAuth: [] }],
				response: {
					200: testerSessionListResponseSchema,
					401: errorResponseSchema,
					403: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const accountId = request.user.accountId as AccountId;
			const threads = await agentThreads.listByAccount(accountId);
			const sessions = await Promise.all(
				threads.map(async (thread) =>
					toTesterSession(thread, await conversations.findById(accountId, thread.conversationId)),
				),
			);
			// Order by transcript activity rather than the thread's own `updatedAt`, so
			// the list matches what the inbox shows.
			sessions.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
			return { data: sessions };
		},
	);

	app.post(
		'/sessions',
		{
			onRequest: [fastify.authenticate, fastify.requireStaff],
			schema: {
				tags: ['admin'],
				summary: 'Open an agent tester session (development only, Rivus staff only)',
				description:
					'Opens the agent thread + inbox conversation for a contact on one channel, ' +
					'exactly as a first inbound message would. Identify the contact either by ' +
					'CRM `customerId` (their email or phone becomes the address) or by a raw ' +
					'`contactAddress` — a raw address is still matched against the CRM, so a ' +
					'known contact links immediately. One session per (channel, contact): a ' +
					'second one conflicts until the first is deleted.',
				security: [{ bearerAuth: [] }],
				body: createTesterSessionSchema,
				response: {
					201: testerSessionResponseSchema,
					400: errorResponseSchema,
					401: errorResponseSchema,
					403: errorResponseSchema,
					404: errorResponseSchema,
					409: errorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const accountId = request.user.accountId as AccountId;
			const { channel, customerId, contactAddress, contactName, subject } = request.body;
			const contact = customerId
				? await contactFromCustomer(accountId, customerId, channel)
				: await contactFromAddress(accountId, contactAddress, contactName, channel);

			// Open the transcript first, with exactly the fields the orchestrator's own
			// `openConversation` writes — a tester session must be indistinguishable
			// from one a real customer opened.
			const senderIsPhone = channel !== 'email';
			const conversation = await conversations.create(accountId, {
				contactName: contact.name,
				channel,
				customerId: contact.customer?.id ?? '',
				contactPhone: contact.customer?.phone || (senderIsPhone ? contact.address : ''),
				status: 'rivus_handling',
				tags: [],
				lastInvoice: '',
			});
			let thread: AgentThread;
			try {
				thread = await agentThreads.create({
					accountId,
					channel,
					contactAddress: contact.address,
					conversationId: conversation.id,
					customerId: contact.customer?.id ?? '',
					// Only email carries a subject; the other channels have none to thread under.
					subject: channel === 'email' ? subject : '',
				});
			} catch (error) {
				// Whatever the failure, the conversation this request just opened must
				// not outlive it — a thread-less transcript would sit orphaned in the
				// inbox. Cleanup is best-effort so it can never mask the real error.
				await conversations.delete(accountId, conversation.id).catch(() => false);
				if (!(error instanceof ConflictError)) {
					throw error;
				}
				// The contact already has a thread on this channel — the orchestrator's
				// loser-cleanup, surfaced as a conflict the app can explain.
				throw app.httpErrors.conflict(
					`A tester session for this contact already exists on ${channel} — delete it to start over.`,
				);
			}
			return reply.code(201).send(toTesterSession(thread, conversation));
		},
	);

	app.get(
		'/sessions/:id',
		{
			onRequest: [fastify.authenticate, fastify.requireStaff],
			schema: {
				tags: ['admin'],
				summary:
					'Fetch one tester session with its transcript (development only, Rivus staff only)',
				security: [{ bearerAuth: [] }],
				params: idParamsSchema,
				response: {
					200: testerSessionDetailResponseSchema,
					401: errorResponseSchema,
					403: errorResponseSchema,
					404: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const accountId = request.user.accountId as AccountId;
			const thread = await requireSession(accountId, request.params.id);
			return loadDetail(accountId, thread);
		},
	);

	app.post(
		'/sessions/:id/messages',
		{
			onRequest: [fastify.authenticate, fastify.requireStaff],
			schema: {
				tags: ['admin'],
				summary: 'Send a message as the customer (development only, Rivus staff only)',
				description:
					'Runs one inbound turn through the real agent pipeline — orchestrator, ' +
					'capabilities, the channel’s own renderer, thread state, and the inbox ' +
					'transcript — with a capturing transport in place of the provider. The ' +
					'reply the customer *would* have received comes back as `delivery` ' +
					'(with the rendered subject and HTML on email) and nothing is sent. On a ' +
					'`phone` session the text is what the caller says and `delivery.text` is ' +
					'the line Rivus would speak back, with `call` reporting whether the call ' +
					'would keep listening or end there.',
				security: [{ bearerAuth: [] }],
				params: idParamsSchema,
				body: testerMessageSchema,
				response: {
					200: testerTurnResponseSchema,
					400: errorResponseSchema,
					401: errorResponseSchema,
					403: errorResponseSchema,
					404: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const accountId = request.user.accountId as AccountId;
			const account = await requireAccount(accountId);
			const thread = await requireSession(accountId, request.params.id);

			if (thread.channel === 'phone') {
				// A call turn goes through the same core the Twilio and Plivo webhooks
				// call, so staff get the real thing rather than a lookalike: spoken
				// numbers normalized ("option one" → "option 1"), the sign-off appended
				// on the outcomes that hang up, dedup off, and the caller identified by
				// number alone — `runVoiceTurn` builds the inbound message exactly as a
				// provider edge does.
				const turn = await runVoiceTurn({
					deps: orchestratorDeps,
					customers,
					capabilities,
					account,
					caller: thread.contactAddress,
					speech: request.body.text,
					logger: request.log,
				});
				const refreshed = await agentThreads.findById(accountId, thread.id);
				const call: 'listen' | 'ended' = turn.mode === 'terminal' ? 'ended' : 'listen';
				return {
					outcome: turn.outcome,
					// The FULL spoken line, sign-off included — what the caller hears,
					// which is more than the utterance the transcript records.
					delivery: { text: turn.text },
					call,
					...(await loadDetail(accountId, refreshed ?? thread)),
				};
			}

			const conversation = await conversations.findById(accountId, thread.conversationId);
			// A per-request harness, so two staff testing at once can't read each
			// other's delivery.
			const harness = createTesterChannel(app.deps, thread.channel);
			const message: InboundAgentMessage = {
				sender: {
					address: thread.contactAddress,
					name: conversation?.contactName || thread.contactAddress,
				},
				text: request.body.text,
				// The tester never re-sends a turn, so every message is new to the
				// orchestrator's dedup and carries no subject of its own.
				subject: '',
				externalMessageId: randomUUID(),
			};
			const result = await handleInboundAgentMessage({
				deps: orchestratorDeps,
				adapter: harness.adapter,
				capabilities,
				account,
				message,
				logger: request.log,
			});

			// Re-read the thread: the turn advanced its state, and the orchestrator
			// re-links a fresh conversation when the transcript was deleted mid-thread.
			const refreshed = await agentThreads.findById(accountId, thread.id);
			return {
				outcome: result.outcome,
				delivery: harness.lastDelivery(),
				...(await loadDetail(accountId, refreshed ?? thread)),
			};
		},
	);

	app.delete(
		'/sessions/:id',
		{
			onRequest: [fastify.authenticate, fastify.requireStaff],
			schema: {
				tags: ['admin'],
				summary:
					'Delete a tester session, resetting the agent (development only, Rivus staff only)',
				description:
					'Deletes the agent thread and its inbox conversation — everything the agent ' +
					'remembers about the contact — so the next session for them starts from a ' +
					'blank slate.',
				security: [{ bearerAuth: [] }],
				params: idParamsSchema,
				response: {
					204: z.null(),
					401: errorResponseSchema,
					403: errorResponseSchema,
					404: errorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const accountId = request.user.accountId as AccountId;
			const thread = await requireSession(accountId, request.params.id);
			// Transcript first, thread second — the failure-friendly order. The thread
			// is the session's identity: while it survives, a retry can always finish
			// the job, whereas deleting it ahead of a failing conversation delete would
			// strand the transcript in the inbox with no session left to delete it
			// through. A transcript already gone (a teammate cleaned the inbox) is fine.
			await conversations.delete(accountId, thread.conversationId);
			const deleted = await agentThreads.delete(accountId, thread.id);
			if (!deleted) {
				// A concurrent delete won between the read and here — nothing left to report.
				throw app.httpErrors.notFound('Tester session not found');
			}
			return reply.code(204).send(null);
		},
	);

	/* ---------------------------- Holding the call --------------------------- */

	app.get(
		'/voice',
		{
			onRequest: [fastify.authenticate, fastify.requireStaff],
			schema: {
				tags: ['admin'],
				summary: 'Whether tester calls can be spoken (development only, Rivus staff only)',
				description:
					'Reports whether this deployment can synthesize and transcribe speech for the ' +
					'tester’s phone sessions — true only when an OpenAI key is configured. The app ' +
					'asks once: when it’s false there is no microphone, and reading a reply aloud ' +
					'falls back to the browser’s own speech synthesis.',
				security: [{ bearerAuth: [] }],
				response: {
					200: testerVoiceResponseSchema,
					401: errorResponseSchema,
					403: errorResponseSchema,
				},
			},
		},
		async () => ({ enabled: testerVoice.enabled }),
	);

	app.post(
		'/sessions/:id/speech',
		{
			onRequest: [fastify.authenticate, fastify.requireStaff],
			schema: {
				tags: ['admin'],
				summary: 'Speak a line of the agent’s reply (development only, Rivus staff only)',
				description:
					'Synthesizes the line Rivus would say on the call — normally the `delivery.text` ' +
					'a turn just returned — and hands back the audio, base64 inside the JSON so it ' +
					'needs no second transport. Nothing about the session changes: this only ' +
					're-renders a reply that already happened. 503 when the deployment has no ' +
					'OpenAI key.',
				security: [{ bearerAuth: [] }],
				params: idParamsSchema,
				body: testerSpeechSchema,
				response: {
					200: testerSpeechResponseSchema,
					400: errorResponseSchema,
					401: errorResponseSchema,
					403: errorResponseSchema,
					404: errorResponseSchema,
					502: errorResponseSchema,
					503: errorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const accountId = request.user.accountId as AccountId;
			await requireSession(accountId, request.params.id);
			if (!testerVoice.enabled) {
				// Sent directly: the central error handler flattens thrown 5xx into a
				// generic 500, and what's worth saying here is which key is missing.
				return reply.code(503).send({
					error: 'Service Unavailable',
					message: 'Speech is not configured on this deployment — set OPENAI_API_KEY.',
					statusCode: 503,
				});
			}
			try {
				return await testerVoice.speak(request.body.text);
			} catch (error) {
				request.log.error({ err: error }, 'tester speech synthesis failed');
				// The speech provider is the failing dependency, so 502 rather than a
				// generic 500 — the tester itself is fine.
				return reply.code(502).send({
					error: 'Bad Gateway',
					message: 'Could not speak that line right now. Please try again.',
					statusCode: 502,
				});
			}
		},
	);

	app.post(
		'/sessions/:id/transcribe',
		{
			onRequest: [fastify.authenticate, fastify.requireStaff],
			// Fastify's 1MB default would refuse a perfectly ordinary utterance. The
			// headroom over the schema's own cap leaves room for the JSON envelope, so
			// an over-long recording gets the schema's friendly 400 rather than a 413.
			bodyLimit: MAX_UTTERANCE_BASE64 + 1024,
			schema: {
				tags: ['admin'],
				summary: 'Transcribe what the caller just said (development only, Rivus staff only)',
				description:
					'Takes one recorded utterance as base64 audio (any container the browser ' +
					'records — the transcriber reads the format from the bytes) and returns the ' +
					'words. The text is what the caller said, to be sent through the normal turn ' +
					'endpoint; an empty `text` means the recording held no speech, which is a ' +
					'normal outcome rather than an error. 503 when the deployment has no OpenAI key.',
				security: [{ bearerAuth: [] }],
				params: idParamsSchema,
				body: testerTranscribeSchema,
				response: {
					200: testerTranscriptionResponseSchema,
					400: errorResponseSchema,
					401: errorResponseSchema,
					403: errorResponseSchema,
					404: errorResponseSchema,
					502: errorResponseSchema,
					503: errorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const accountId = request.user.accountId as AccountId;
			await requireSession(accountId, request.params.id);
			if (!testerVoice.enabled) {
				return reply.code(503).send({
					error: 'Service Unavailable',
					message: 'Speech is not configured on this deployment — set OPENAI_API_KEY.',
					statusCode: 503,
				});
			}
			// Base64 decoding is lenient — it drops what it doesn't recognize — so the
			// only thing worth checking is that something survived it. Sending the
			// provider zero bytes would just buy a slow failure.
			const bytes = Buffer.from(request.body.audio, 'base64');
			if (bytes.length === 0) {
				throw app.httpErrors.badRequest('That recording came through empty — try again.');
			}
			try {
				return { text: await testerVoice.transcribe(bytes) };
			} catch (error) {
				request.log.error({ err: error }, 'tester transcription failed');
				return reply.code(502).send({
					error: 'Bad Gateway',
					message: 'Could not make out that recording right now. Please try again.',
					statusCode: 502,
				});
			}
		},
	);
};

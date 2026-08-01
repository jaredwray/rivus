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
	testerTurnResponseSchema,
} from '../http-schemas';
import { toTesterSession } from '../presenters';
import { ConflictError } from '../repositories/errors';
import { defaultCapabilities } from '../services/agent/capabilities';
import type { InboundAgentMessage } from '../services/agent/channel';
import { handleInboundAgentMessage } from '../services/agent/orchestrator';
import {
	createTesterChannel,
	isTesterThread,
	type TesterChannel,
	type TesterThread,
} from '../services/agent/tester';

/**
 * The Agent Tester: a development-only, staff-only chat harness for the
 * customer-facing agent. Each endpoint drives the SAME pipeline a real inbound
 * message does — the shared orchestrator, the registered capabilities, the
 * channel's own renderer, the thread's machine state, and the inbox transcript —
 * with only the transport swapped for a capturing one (see
 * `services/agent/tester.ts`), so a turn is exercised end to end without a
 * message ever leaving the building.
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
	const { accounts, agentThreads, conversations, customers, config, jobs } = app.deps;
	const orchestratorDeps = { config, jobs, conversations, agentThreads };
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
	 * The thread behind a session id. A thread from another account, an unknown
	 * id, or a `phone` thread (no transport to capture) is uniformly "not found" —
	 * the tester never reveals that someone else's session exists.
	 */
	async function requireSession(accountId: AccountId, id: string): Promise<TesterThread> {
		const thread = await agentThreads.findById(accountId, id as AgentThreadId);
		if (!thread || !isTesterThread(thread)) {
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
				throw app.httpErrors.badRequest(
					'Enter a phone number Rivus can text, like (555) 123-4567.',
				);
			}
			customer = await customers.findByPhone(accountId, address);
		}
		return { address, name: contactName || address, customer };
	}

	/** A session's two halves, for the responses that carry the transcript. */
	async function loadDetail(accountId: AccountId, thread: TesterThread) {
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
					'Every agent thread on the current account that the tester can drive — one ' +
					'per (channel, contact) — joined with the inbox conversation carrying its ' +
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
			// `phone` threads have no capture transport, so they aren't testable.
			const threads = (await agentThreads.listByAccount(accountId)).filter(isTesterThread);
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
				if (!(error instanceof ConflictError)) {
					throw error;
				}
				// The contact already has a thread on this channel (the orchestrator's
				// loser-cleanup): drop the conversation this request just opened rather
				// than leaving it orphaned in the inbox.
				await conversations.delete(accountId, conversation.id);
				throw app.httpErrors.conflict(
					`A tester session for this contact already exists on ${channel} — delete it to start over.`,
				);
			}
			// The store echoes the channel we passed, so the created thread is a
			// tester thread by construction.
			return reply.code(201).send(toTesterSession({ ...thread, channel }, conversation));
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
					'(with the rendered subject and HTML on email) and nothing is sent.',
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
			const current = refreshed && isTesterThread(refreshed) ? refreshed : thread;
			return {
				outcome: result.outcome,
				delivery: harness.lastDelivery(),
				...(await loadDetail(accountId, current)),
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
			// The thread is the session's identity, so it goes first: if it is already
			// gone, a concurrent delete won and there is nothing to report as deleted.
			const deleted = await agentThreads.delete(accountId, thread.id);
			if (!deleted) {
				throw app.httpErrors.notFound('Tester session not found');
			}
			// A transcript a teammate already deleted from the inbox is fine.
			await conversations.delete(accountId, thread.conversationId);
			return reply.code(204).send(null);
		},
	);
};

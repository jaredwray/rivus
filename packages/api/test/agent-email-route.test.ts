import { type AccountId, agentEmailLocalPart } from '@rivus/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createInMemoryRepositories } from '../src/repositories/memory';
import type { ReceivedEmailContent } from '../src/services/agent/email/received';
import { NoopReceivedEmailReader } from '../src/services/agent/email/received';
import { signWebhookPayload } from '../src/services/agent/email/webhook';
import { NoopChannelProvisioner } from '../src/services/channel-provisioning';
import { NoopFaqAnswerService } from '../src/services/faq-answer';
import { NoopFaqSimilarityService } from '../src/services/faq-similarity';
import { createNotificationService } from '../src/services/notifications';
import { NoopSmsSender } from '../src/services/sms';
import { NoopWhatsappSender } from '../src/services/whatsapp';
import { buildTestApp, buildTestAppWithRepos, RecordingMailer, signupOwner } from './helpers';

const WEBHOOK_URL = '/v1/channels/email/inbound';
const SENDER = 'dana@example.com';

interface PayloadOverrides {
	type?: string;
	from?: string;
	to?: string[];
	cc?: string[];
	received_for?: string[];
	subject?: string;
	text?: string;
	html?: string;
	headers?: Record<string, string>;
	email_id?: string;
	message_id?: string;
	omitText?: boolean;
}

/** A realistic `email.received` payload with the body embedded (no fetch needed). */
function inboundPayload(slug: string, overrides: PayloadOverrides = {}) {
	const { type, omitText, ...data } = overrides;
	return {
		type: type ?? 'email.received',
		created_at: new Date().toISOString(),
		data: {
			email_id: 'em_1',
			from: `Dana Fox <${SENDER}>`,
			to: [`${slug}@riv.us`],
			cc: [],
			received_for: [],
			message_id: '<m1@mail.example.com>',
			subject: 'Water heater',
			...(omitText ? {} : { text: 'Hi! I need someone to look at my water heater.' }),
			headers: {},
			...data,
		},
	};
}

function agentMailbox(app: FastifyInstance): RecordingMailer {
	return app.deps.mailer as RecordingMailer;
}

describe('POST /v1/channels/email/inbound — end to end', () => {
	it('walks a stranger from signup link to a confirmed booking over four emails', async () => {
		const { app, repos } = await buildTestAppWithRepos();
		const owner = await signupOwner(app);
		const slug = owner.account.slug;
		const accountId = owner.account.id as AccountId;
		const mailer = agentMailbox(app);

		// ── Email 1: a stranger writes in ─────────────────────────────────────
		const first = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inboundPayload(slug),
		});
		expect(first.statusCode).toBe(200);
		expect(first.json()).toEqual({ handled: true, outcome: 'send_signup_link' });

		// The agent replied from the account's own address — the business slug plus
		// its unique hex tag — with the signup link.
		expect(mailer.agentEmails).toHaveLength(1);
		const signupReply = mailer.agentEmails[0];
		expect(signupReply?.to).toBe(SENDER);
		expect(signupReply?.from).toContain(`<${agentEmailLocalPart(slug, accountId)}@riv.us>`);
		expect(signupReply?.subject).toBe('Re: Water heater');
		expect(signupReply?.inReplyTo).toBe('<m1@mail.example.com>');
		expect(signupReply?.text).toContain(
			`/customers/join/${encodeURIComponent(slug)}?email=${encodeURIComponent(SENDER)}`,
		);

		// Thread state advanced and the exchange landed in the team inbox.
		let thread = await repos.agentThreads.findByContact(accountId, 'email', SENDER);
		expect(thread?.state).toBe('awaiting_signup');
		expect(thread?.customerId).toBe('');
		const transcript1 = await repos.conversations.listMessages(
			accountId,
			thread?.conversationId ?? ('' as never),
		);
		expect(transcript1?.map((message) => message.author)).toEqual(['customer', 'rivus']);

		// ── The customer adds themselves via the public signup view ──────────
		const signup = await app.inject({
			method: 'POST',
			url: `/v1/public/accounts/${slug}/customers`,
			payload: { name: 'Dana Fox', email: SENDER, phone: '+1 206 555 0100' },
		});
		expect(signup.statusCode).toBe(201);

		// ── Email 2: now recognized, the agent offers times ──────────────────
		const second = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inboundPayload(slug, {
				text: 'Done — signed up! When could you come by?',
				message_id: '<m2@mail.example.com>',
				subject: 'Re: Water heater',
			}),
		});
		expect(second.json()).toEqual({ handled: true, outcome: 'offer_slots' });

		thread = await repos.agentThreads.findByContact(accountId, 'email', SENDER);
		expect(thread?.state).toBe('slots_offered');
		expect(thread?.offeredSlots.length).toBeGreaterThan(0);
		expect(thread?.customerId).not.toBe('');
		const offerReply = mailer.agentEmails.at(-1);
		expect(offerReply?.text).toContain('1.');
		expect(offerReply?.inReplyTo).toBe('<m2@mail.example.com>');

		// The conversation is now linked to the CRM customer record.
		const conversation = await repos.conversations.findById(
			accountId,
			thread?.conversationId ?? ('' as never),
		);
		expect(conversation?.customerId).toBe(thread?.customerId);
		expect(conversation?.contactName).toBe('Dana Fox');

		// ── Email 3: the customer picks option 1 → booked ────────────────────
		const offeredStart = thread?.offeredSlots[0]?.startAt ?? '';
		const third = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inboundPayload(slug, {
				text: 'Option 1 works great, thanks!',
				message_id: '<m3@mail.example.com>',
				subject: 'Re: Water heater',
			}),
		});
		expect(third.json()).toEqual({ handled: true, outcome: 'book' });

		thread = await repos.agentThreads.findByContact(accountId, 'email', SENDER);
		expect(thread?.state).toBe('booked');
		expect(thread?.bookedJobId).not.toBe('');

		// The job exists on the calendar: confirmed, unassigned, right customer.
		const { jobs } = await repos.jobs.list({ accountId, page: 1, pageSize: 100 });
		expect(jobs).toHaveLength(1);
		expect(jobs[0]).toMatchObject({
			id: thread?.bookedJobId,
			title: 'Water heater',
			status: 'confirmed',
			customerId: thread?.customerId,
			assignedUserId: '',
			startAt: offeredStart,
			durationMinutes: 60,
		});

		// The confirmation email and the inbox note both record the booking.
		const confirmation = mailer.agentEmails.at(-1);
		expect(confirmation?.text).toContain("You're booked!");
		const transcript = await repos.conversations.listMessages(
			accountId,
			thread?.conversationId ?? ('' as never),
		);
		expect(transcript?.map((message) => message.author)).toEqual([
			'customer',
			'rivus',
			'customer',
			'rivus',
			'customer',
			'rivus',
			'note',
		]);
		expect(transcript?.at(-1)?.body).toContain('Rivus booked Water heater');

		// ── Email 4: a later message starts a fresh round on the same thread ─
		const fourth = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inboundPayload(slug, {
				text: 'Actually I need a second visit too — what else is open?',
				message_id: '<m4@mail.example.com>',
			}),
		});
		expect(fourth.json()).toEqual({ handled: true, outcome: 'offer_slots' });

		await app.close();
	});

	it('books a time the customer proposes themselves when it is open', async () => {
		const { app, repos } = await buildTestAppWithRepos();
		const owner = await signupOwner(app);
		const slug = owner.account.slug;
		const accountId = owner.account.id as AccountId;
		await repos.customers.create(accountId, {
			name: 'Dana Fox',
			email: SENDER,
			phone: '',
			address: '12 Pine St',
			lifetimeValue: 0,
			balance: 0,
			notes: '',
		});

		// A deterministic weekday ≥7 days out at 10:00 (account timezone is UTC by
		// default), written the way a person would type it.
		const target = new Date();
		target.setUTCDate(target.getUTCDate() + 7);
		while (target.getUTCDay() === 0 || target.getUTCDay() === 6) {
			target.setUTCDate(target.getUTCDate() + 1);
		}
		const yyyy = target.getUTCFullYear();
		const mm = String(target.getUTCMonth() + 1).padStart(2, '0');
		const dd = String(target.getUTCDate()).padStart(2, '0');

		const response = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inboundPayload(slug, { text: `Could you do ${yyyy}-${mm}-${dd} 10:00?` }),
		});
		expect(response.json()).toEqual({ handled: true, outcome: 'book' });

		const { jobs } = await repos.jobs.list({ accountId, page: 1, pageSize: 10 });
		expect(jobs[0]?.startAt).toBe(`${yyyy}-${mm}-${dd}T10:00:00.000Z`);
		// The job site defaults to the customer's address on file.
		expect(jobs[0]?.address).toBe('12 Pine St');

		await app.close();
	});

	it('reassures a booked customer who just confirms, instead of re-offering slots', async () => {
		const { app, repos } = await buildTestAppWithRepos();
		const owner = await signupOwner(app);
		const slug = owner.account.slug;
		const accountId = owner.account.id as AccountId;
		const mailer = agentMailbox(app);
		await repos.customers.create(accountId, {
			name: 'Dana Fox',
			email: SENDER,
			phone: '',
			address: '',
			lifetimeValue: 0,
			balance: 0,
			notes: '',
		});

		// A deterministic weekday ≥7 days out at 10:00 (account timezone is UTC).
		const target = new Date();
		target.setUTCDate(target.getUTCDate() + 7);
		while (target.getUTCDay() === 0 || target.getUTCDay() === 6) {
			target.setUTCDate(target.getUTCDate() + 1);
		}
		const yyyy = target.getUTCFullYear();
		const mm = String(target.getUTCMonth() + 1).padStart(2, '0');
		const dd = String(target.getUTCDate()).padStart(2, '0');

		const booked = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inboundPayload(slug, {
				text: `Could you do ${yyyy}-${mm}-${dd} 10:00?`,
				message_id: '<c1@mail.example.com>',
			}),
		});
		expect(booked.json()).toEqual({ handled: true, outcome: 'book' });
		const afterBooking = await repos.agentThreads.findByContact(accountId, 'email', SENDER);
		expect(afterBooking?.state).toBe('booked');

		// The customer simply acknowledges. This must not reopen scheduling — the
		// bug this guards against re-offered three fresh openings after "Confirmed!".
		const confirmed = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inboundPayload(slug, {
				text: 'Confirmed!',
				message_id: '<c2@mail.example.com>',
			}),
		});
		expect(confirmed.json()).toEqual({ handled: true, outcome: 'confirm_existing' });

		// The thread stays booked against the same job; no second round, no new job.
		const afterConfirm = await repos.agentThreads.findByContact(accountId, 'email', SENDER);
		expect(afterConfirm?.state).toBe('booked');
		expect(afterConfirm?.bookedJobId).toBe(afterBooking?.bookedJobId);
		expect(afterConfirm?.offeredSlots).toEqual([]);
		const { jobs } = await repos.jobs.list({ accountId, page: 1, pageSize: 10 });
		expect(jobs).toHaveLength(1);

		// The reply reassures the standing booking and never lists fresh openings.
		const reply = mailer.agentEmails.at(-1);
		expect(reply?.text).toContain('already booked');
		expect(reply?.text).not.toContain('openings');

		await app.close();
	});

	it('offers alternatives when the picked slot got booked in the meantime', async () => {
		const { app, repos } = await buildTestAppWithRepos();
		const owner = await signupOwner(app);
		const slug = owner.account.slug;
		const accountId = owner.account.id as AccountId;
		await repos.customers.create(accountId, {
			name: 'Dana Fox',
			email: SENDER,
			phone: '',
			address: '',
			lifetimeValue: 0,
			balance: 0,
			notes: '',
		});

		await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inboundPayload(slug, { text: 'When are you free?' }),
		});
		const thread = await repos.agentThreads.findByContact(accountId, 'email', SENDER);
		const offered = thread?.offeredSlots[0];
		expect(offered).toBeDefined();

		// The team books over the offered slot before the customer answers.
		await repos.jobs.create(accountId, {
			title: 'Emergency call-out',
			customerId: '',
			assignedUserId: '',
			startAt: offered?.startAt ?? '',
			durationMinutes: 60,
			status: 'scheduled',
			address: '',
			notes: '',
			estimatedValue: 0,
		});

		const response = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inboundPayload(slug, { text: '1', message_id: '<m2@mail.example.com>' }),
		});
		expect(response.json()).toEqual({ handled: true, outcome: 'propose_unavailable' });
		const reply = agentMailbox(app).agentEmails.at(-1);
		expect(reply?.text).toContain('was just taken');
		expect(reply?.text).toContain('1.');

		// No second job was created.
		const { total } = await repos.jobs.list({ accountId, page: 1, pageSize: 10 });
		expect(total).toBe(1);

		await app.close();
	});

	it('fetches the body via the received-emails reader when the payload has none', async () => {
		const requested: string[] = [];
		const reader = {
			async get(emailId: string): Promise<ReceivedEmailContent | null> {
				requested.push(emailId);
				return {
					text: 'Hello, do you have anything tomorrow?',
					html: '',
					headers: {},
					messageId: '<fetched@mail.example.com>',
				};
			},
		};
		const app = await buildTestApp({ receivedEmails: reader });
		const owner = await signupOwner(app);

		const response = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inboundPayload(owner.account.slug, { omitText: true, email_id: 'em_42' }),
		});
		expect(requested).toEqual(['em_42']);
		expect(response.json()).toEqual({ handled: true, outcome: 'send_signup_link' });
		// The Message-ID came from the fetched content, not the (absent) payload one.
		expect(agentMailbox(app).agentEmails[0]?.inReplyTo).toBe('<m1@mail.example.com>');

		await app.close();
	});

	it('ignores non-received event types, unknown accounts, and unparseable payloads', async () => {
		const app = await buildTestApp();
		const owner = await signupOwner(app);

		const delivered = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inboundPayload(owner.account.slug, { type: 'email.delivered' }),
		});
		expect(delivered.json()).toEqual({ handled: false, outcome: 'ignored_event_type' });

		const unknownAccount = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inboundPayload('no-such-business'),
		});
		expect(unknownAccount.json()).toEqual({ handled: false, outcome: 'unknown_account' });

		const notAgentDomain = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inboundPayload(owner.account.slug, { to: ['someone@example.com'] }),
		});
		expect(notAgentDomain.json()).toEqual({ handled: false, outcome: 'no_agent_recipient' });

		const garbage = await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: { nope: 1 } });
		expect(garbage.json()).toEqual({ handled: false, outcome: 'unrecognized_payload' });

		const badSender = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inboundPayload(owner.account.slug, { from: 'not-an-address' }),
		});
		expect(badSender.json()).toEqual({ handled: false, outcome: 'unparseable_sender' });

		// Nothing was ever sent for any of these.
		expect(agentMailbox(app).agentEmails).toHaveLength(0);
		await app.close();
	});

	it('never answers auto-generated mail or its own domain (loop guard)', async () => {
		const app = await buildTestApp();
		const owner = await signupOwner(app);
		const slug = owner.account.slug;

		const outOfOffice = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inboundPayload(slug, { headers: { 'auto-submitted': 'auto-replied' } }),
		});
		expect(outOfOffice.json()).toEqual({ handled: false, outcome: 'auto_generated' });

		const selfMail = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inboundPayload(slug, { from: `other-agent@riv.us` }),
		});
		expect(selfMail.json()).toEqual({ handled: false, outcome: 'auto_generated' });

		expect(agentMailbox(app).agentEmails).toHaveLength(0);
		await app.close();
	});
});

describe('POST /v1/channels/email/inbound — address resolution', () => {
	it('resolves mail sent to the canonical `<slug>-<hex>@riv.us` address', async () => {
		const app = await buildTestApp();
		const owner = await signupOwner(app);
		const tagged = agentEmailLocalPart(owner.account.slug, owner.account.id as AccountId);

		const response = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inboundPayload(owner.account.slug, { to: [`${tagged}@riv.us`] }),
		});
		expect(response.json()).toEqual({ handled: true, outcome: 'send_signup_link' });

		// And the reply goes back out from that same tagged address.
		expect(agentMailbox(app).agentEmails.at(-1)?.from).toContain(`<${tagged}@riv.us>`);
		await app.close();
	});

	it('rejects a tagged address whose slug matches no account', async () => {
		const app = await buildTestApp();
		await signupOwner(app);
		const response = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inboundPayload('no-such-business', { to: ['no-such-business-abcdef12@riv.us'] }),
		});
		expect(response.json()).toEqual({ handled: false, outcome: 'unknown_account' });
		expect(agentMailbox(app).agentEmails).toHaveLength(0);
		await app.close();
	});

	it('throws away mail to the other environment’s domain alias', async () => {
		// A production-configured API (AGENT_EMAIL_DOMAIN defaults to riv.us) must
		// ignore mail to the development alias `@dev.riv.us` — even for a real
		// account — so the two deployments never share an inbox.
		const app = await buildTestApp();
		const owner = await signupOwner(app);
		const tagged = agentEmailLocalPart(owner.account.slug, owner.account.id as AccountId);

		const response = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inboundPayload(owner.account.slug, { to: [`${tagged}@dev.riv.us`] }),
		});
		expect(response.json()).toEqual({ handled: false, outcome: 'no_agent_recipient' });
		expect(agentMailbox(app).agentEmails).toHaveLength(0);
		await app.close();
	});

	it('serves its own domain and rejects the production alias when configured for development', async () => {
		// The development deployment runs AGENT_EMAIL_DOMAIN=dev.riv.us: it answers
		// mail to `@dev.riv.us` and throws away mail to the bare production `@riv.us`.
		const app = await buildTestApp({
			config: loadConfig({
				NODE_ENV: 'test',
				JWT_SECRET: 'test-secret-value-1234',
				AGENT_EMAIL_DOMAIN: 'dev.riv.us',
			} as NodeJS.ProcessEnv),
		});
		const owner = await signupOwner(app);
		const tagged = agentEmailLocalPart(owner.account.slug, owner.account.id as AccountId);

		const served = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inboundPayload(owner.account.slug, { to: [`${tagged}@dev.riv.us`] }),
		});
		expect(served.json()).toEqual({ handled: true, outcome: 'send_signup_link' });
		// The reply goes back out from that same dev-domain address.
		expect(agentMailbox(app).agentEmails.at(-1)?.from).toContain(`<${tagged}@dev.riv.us>`);

		const prodAlias = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inboundPayload(owner.account.slug, { to: [`${tagged}@riv.us`] }),
		});
		expect(prodAlias.json()).toEqual({ handled: false, outcome: 'no_agent_recipient' });
		await app.close();
	});
});

describe('POST /v1/channels/email/inbound — signatures', () => {
	const SECRET = `whsec_${Buffer.from('route-test-key').toString('base64')}`;
	let app: FastifyInstance | undefined;

	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	async function buildSignedApp(): Promise<FastifyInstance> {
		return buildTestApp({
			config: loadConfig({
				NODE_ENV: 'test',
				JWT_SECRET: 'test-secret-value-1234',
				RESEND_WEBHOOK_SECRET: SECRET,
			} as NodeJS.ProcessEnv),
		});
	}

	it('accepts a correctly signed delivery', async () => {
		app = await buildSignedApp();
		const owner = await signupOwner(app);
		const payload = JSON.stringify(inboundPayload(owner.account.slug));
		const timestamp = String(Math.floor(Date.now() / 1000));
		const response = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload,
			headers: {
				'content-type': 'application/json',
				'svix-id': 'msg_1',
				'svix-timestamp': timestamp,
				'svix-signature': signWebhookPayload({ secret: SECRET, id: 'msg_1', timestamp, payload }),
			},
		});
		expect(response.statusCode).toBe(200);
		expect(response.json().handled).toBe(true);
	});

	it('rejects a missing or invalid signature with 401', async () => {
		app = await buildSignedApp();
		const owner = await signupOwner(app);
		const unsigned = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inboundPayload(owner.account.slug),
		});
		expect(unsigned.statusCode).toBe(401);

		const payload = JSON.stringify(inboundPayload(owner.account.slug));
		const timestamp = String(Math.floor(Date.now() / 1000));
		const tampered = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: `${payload.slice(0, -1)} }`,
			headers: {
				'content-type': 'application/json',
				'svix-id': 'msg_1',
				'svix-timestamp': timestamp,
				'svix-signature': signWebhookPayload({ secret: SECRET, id: 'msg_1', timestamp, payload }),
			},
		});
		expect(tampered.statusCode).toBe(401);
	});

	it('rejects a body that is not valid JSON with 400', async () => {
		app = await buildSignedApp();
		const response = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: '{not json',
			headers: { 'content-type': 'application/json' },
		});
		expect(response.statusCode).toBe(400);
	});

	it('refuses to serve unsigned in production (503, fail closed)', async () => {
		const repos = createInMemoryRepositories();
		app = buildApp({
			config: loadConfig({
				NODE_ENV: 'production',
				JWT_SECRET: 'x'.repeat(32),
				RESEND_API_KEY: 're_test_key',
				LOG_LEVEL: 'silent',
				CORS_ORIGIN: 'https://app.rivus.ai',
			} as NodeJS.ProcessEnv),
			...repos,
			mailer: new RecordingMailer(),
			receivedEmails: new NoopReceivedEmailReader(),
			whatsappSender: new NoopWhatsappSender(),
			whatsappProvisioner: new NoopChannelProvisioner(),
			smsSender: new NoopSmsSender(),
			smsProvisioner: new NoopChannelProvisioner(),
			notifier: createNotificationService({ notifications: repos.notifications }),
			faqSimilarity: new NoopFaqSimilarityService(),
			faqAnswer: new NoopFaqAnswerService(),
			ping: async () => ({ ready: true }),
		});
		const response = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inboundPayload('any-slug'),
		});
		expect(response.statusCode).toBe(503);
	});
});

describe('POST /v1/channels/email/inbound — delivery semantics (review-driven)', () => {
	it('ignores an exact redelivery of an already-processed email', async () => {
		const { app, repos } = await buildTestAppWithRepos();
		const owner = await signupOwner(app);
		const accountId = owner.account.id as AccountId;
		const payload = inboundPayload(owner.account.slug);

		const first = await app.inject({ method: 'POST', url: WEBHOOK_URL, payload });
		expect(first.json()).toEqual({ handled: true, outcome: 'send_signup_link' });

		// Resend redelivers the identical event (at-least-once delivery).
		const second = await app.inject({ method: 'POST', url: WEBHOOK_URL, payload });
		expect(second.json()).toEqual({ handled: false, outcome: 'duplicate_delivery' });

		// No duplicate transcript lines, no second reply.
		const thread = await repos.agentThreads.findByContact(accountId, 'email', SENDER);
		const transcript = await repos.conversations.listMessages(
			accountId,
			thread?.conversationId ?? ('' as never),
		);
		expect(transcript?.map((message) => message.author)).toEqual(['customer', 'rivus']);
		expect(agentMailbox(app).agentEmails).toHaveLength(1);
		await app.close();
	});

	it('undoes the booking when the confirmation email fails, and the retry re-books', async () => {
		class FlakyMailer extends RecordingMailer {
			failNext = false;
			override async sendAgentEmail(email: Parameters<RecordingMailer['sendAgentEmail']>[0]) {
				if (this.failNext) {
					this.failNext = false;
					throw new Error('Resend rejected the email (status 500)');
				}
				return super.sendAgentEmail(email);
			}
		}
		const repos = createInMemoryRepositories();
		const mailer = new FlakyMailer();
		const app = await buildTestApp({ ...repos, mailer });
		const owner = await signupOwner(app);
		const accountId = owner.account.id as AccountId;
		await repos.customers.create(accountId, {
			name: 'Dana Fox',
			email: SENDER,
			phone: '',
			address: '',
			lifetimeValue: 0,
			balance: 0,
			notes: '',
		});

		await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inboundPayload(owner.account.slug, { text: 'When are you free?' }),
		});

		// The confirmation send blows up mid-booking.
		mailer.failNext = true;
		const pick = inboundPayload(owner.account.slug, {
			text: 'option 1',
			message_id: '<m3@mail.example.com>',
		});
		const failed = await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: pick });
		expect(failed.statusCode).toBe(500);

		// The orphaned job was rolled back and the thread did not advance.
		expect((await repos.jobs.list({ accountId, page: 1, pageSize: 10 })).total).toBe(0);
		let thread = await repos.agentThreads.findByContact(accountId, 'email', SENDER);
		expect(thread?.state).toBe('slots_offered');
		expect(thread?.bookedJobId).toBe('');

		// Resend redelivers after the 500 — this time everything lands.
		const retried = await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: pick });
		expect(retried.json()).toEqual({ handled: true, outcome: 'book' });
		expect((await repos.jobs.list({ accountId, page: 1, pageSize: 10 })).total).toBe(1);
		thread = await repos.agentThreads.findByContact(accountId, 'email', SENDER);
		expect(thread?.state).toBe('booked');
		await app.close();
	});

	it('5xxs (so Resend retries) when the email body cannot be fetched', async () => {
		// The default test reader is the no-op one — a payload with no embedded
		// body therefore behaves like a transient Resend fetch failure.
		const app = await buildTestApp();
		const owner = await signupOwner(app);
		const response = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inboundPayload(owner.account.slug, { omitText: true }),
		});
		expect(response.statusCode).toBe(500);
		expect(agentMailbox(app).agentEmails).toHaveLength(0);
		await app.close();
	});

	it('recovers when a concurrent delivery wins the thread-creation race', async () => {
		const repos = createInMemoryRepositories();
		// Simulate the race deterministically: the first lookup misses (as it
		// would while the winner's create is in flight), then reality returns.
		let missedOnce = false;
		const racingThreads: typeof repos.agentThreads = Object.create(repos.agentThreads);
		racingThreads.findByContact = async (accountId, channel, contactAddress) => {
			if (!missedOnce) {
				missedOnce = true;
				return null;
			}
			return repos.agentThreads.findByContact(accountId, channel, contactAddress);
		};
		const app = await buildTestApp({ ...repos, agentThreads: racingThreads });
		const owner = await signupOwner(app);
		const accountId = owner.account.id as AccountId;

		// The "winner" (a concurrent delivery) already created the thread.
		const conversation = await repos.conversations.create(accountId, {
			contactName: 'Dana Fox',
			channel: 'email',
			customerId: '',
			contactPhone: '',
			status: 'rivus_handling',
			tags: [],
			lastInvoice: '',
		});
		await repos.agentThreads.create({
			accountId,
			channel: 'email',
			contactAddress: SENDER,
			conversationId: conversation.id,
			customerId: '',
			subject: 'Water heater',
		});

		const response = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inboundPayload(owner.account.slug),
		});
		expect(response.json()).toEqual({ handled: true, outcome: 'send_signup_link' });

		// The loser's provisional conversation was cleaned up — only the winner's remains.
		const { total } = await repos.conversations.list({ accountId, page: 1, pageSize: 10 });
		expect(total).toBe(1);
		await app.close();
	});

	it('confirms (not re-books) when the customer restates their booked time', async () => {
		const { app, repos } = await buildTestAppWithRepos();
		const owner = await signupOwner(app);
		const accountId = owner.account.id as AccountId;
		await repos.customers.create(accountId, {
			name: 'Dana Fox',
			email: SENDER,
			phone: '',
			address: '',
			lifetimeValue: 0,
			balance: 0,
			notes: '',
		});

		await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inboundPayload(owner.account.slug, { text: 'When are you free?' }),
		});
		const offered = (await repos.agentThreads.findByContact(accountId, 'email', SENDER))
			?.offeredSlots[0];
		await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inboundPayload(owner.account.slug, {
				text: '1',
				message_id: '<m2@mail.example.com>',
			}),
		});

		// "See you then" naming the exact booked time (account timezone is UTC).
		const startAt = offered?.startAt ?? '';
		const wallClock = `${startAt.slice(0, 10)} ${startAt.slice(11, 16)}`;
		const response = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inboundPayload(owner.account.slug, {
				text: `Great — see you ${wallClock}!`,
				message_id: '<m3@mail.example.com>',
			}),
		});
		expect(response.json()).toEqual({ handled: true, outcome: 'confirm_existing' });
		expect(agentMailbox(app).agentEmails.at(-1)?.text).toContain('already booked');

		// Still exactly one job; the thread stays booked.
		expect((await repos.jobs.list({ accountId, page: 1, pageSize: 10 })).total).toBe(1);
		expect((await repos.agentThreads.findByContact(accountId, 'email', SENDER))?.state).toBe(
			'booked',
		);
		await app.close();
	});
});

/** A Resend delivery-status webhook (bounce / spam complaint) for a reply Rivus sent. */
function deliveryPayload(type: 'email.bounced' | 'email.complained', slug: string, to = SENDER) {
	return {
		type,
		created_at: new Date().toISOString(),
		data: {
			email_id: 'em_out_1',
			// A delivery event is about mail *Rivus sent*: from the agent address, to the customer.
			from: `Cascade Plumbing <${slug}@riv.us>`,
			to: [to],
			subject: 'Re: Water heater',
		},
	};
}

describe('POST /v1/channels/email/inbound — outbound delivery failures', () => {
	async function withThread() {
		const { app, repos } = await buildTestAppWithRepos();
		const owner = await signupOwner(app);
		const slug = owner.account.slug;
		const accountId = owner.account.id as AccountId;
		await repos.customers.create(accountId, {
			name: 'Dana Fox',
			email: SENDER,
			phone: '',
			address: '',
			lifetimeValue: 0,
			balance: 0,
			notes: '',
		});
		// One inbound message opens the thread + conversation (agent offers slots).
		await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: inboundPayload(slug) });
		const thread = await repos.agentThreads.findByContact(accountId, 'email', SENDER);
		return { app, repos, slug, accountId, conversationId: thread?.conversationId ?? ('' as never) };
	}

	it('flags the conversation for a human when a reply bounces', async () => {
		const { app, repos, slug, accountId, conversationId } = await withThread();

		const response = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: deliveryPayload('email.bounced', slug),
		});
		expect(response.json()).toEqual({ handled: true, outcome: 'delivery_bounced' });

		const conversation = await repos.conversations.findById(accountId, conversationId);
		expect(conversation?.status).toBe('needs_attention');
		expect(conversation?.flagReason).toContain("didn't reach");
		const messages = await repos.conversations.listMessages(accountId, conversationId);
		expect(messages?.at(-1)?.author).toBe('note');
		expect(messages?.at(-1)?.body).toContain('bounced');

		// The team was notified.
		const userId = (await repos.memberships.listByAccount(accountId))[0]?.userId;
		if (!userId) {
			throw new Error('expected the owner to have a membership');
		}
		const notifications = await repos.notifications.list({
			accountId,
			userId,
			page: 1,
			pageSize: 10,
			unreadOnly: false,
		});
		expect(notifications.notifications.some((n) => n.title === 'A conversation needs you')).toBe(
			true,
		);
		await app.close();
	});

	it('uses spam-complaint wording for email.complained', async () => {
		const { app, repos, slug, accountId, conversationId } = await withThread();
		const response = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: deliveryPayload('email.complained', slug),
		});
		expect(response.json()).toEqual({ handled: true, outcome: 'delivery_complained' });
		const messages = await repos.conversations.listMessages(accountId, conversationId);
		expect(messages?.at(-1)?.body).toContain('spam');
		await app.close();
	});

	it('is idempotent — a redelivered bounce does not stack notes', async () => {
		const { app, repos, slug, accountId, conversationId } = await withThread();
		await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: deliveryPayload('email.bounced', slug),
		});
		const afterFirst = (await repos.conversations.listMessages(accountId, conversationId))?.length;

		const second = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: deliveryPayload('email.bounced', slug),
		});
		expect(second.json()).toEqual({ handled: false, outcome: 'already_flagged' });
		const afterSecond = (await repos.conversations.listMessages(accountId, conversationId))?.length;
		expect(afterSecond).toBe(afterFirst);
		await app.close();
	});

	it('ignores a delivery event whose sender is not an agent address, or with no thread', async () => {
		const { app, slug } = await withThread();
		// Not our domain.
		const notOurs = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: {
				type: 'email.bounced',
				data: { email_id: 'x', from: 'hello@rivus.ai', to: [SENDER], subject: 'x' },
			},
		});
		expect(notOurs.json()).toEqual({ handled: false, outcome: 'not_agent_sender' });

		// Our domain + account, but a recipient we have no thread for.
		const noThread = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: deliveryPayload('email.bounced', slug, 'stranger@nowhere.example'),
		});
		expect(noThread.json()).toEqual({ handled: false, outcome: 'no_thread' });
		await app.close();
	});
});

import type { AccountId } from '@rivus/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createInMemoryRepositories } from '../src/repositories/memory';
import { NoopReceivedEmailReader } from '../src/services/agent/email/received';
import { NoopChannelProvisioner } from '../src/services/channel-provisioning';
import { NoopFaqAnswerService } from '../src/services/faq-answer';
import { NoopFaqSimilarityService } from '../src/services/faq-similarity';
import { createNotificationService } from '../src/services/notifications';
import { signZernioPayload } from '../src/services/zernio-whatsapp';
import {
	buildTestAppWithRepos,
	RecordingMailer,
	RecordingSmsSender,
	RecordingWhatsappSender,
	signupOwner,
} from './helpers';

const WEBHOOK_URL = '/v1/channels/whatsapp/inbound';
const BIZ = '+15550001111';
const SENDER = '+15559990000';

interface InboundOverrides {
	to?: string;
	from?: string;
	text?: string;
	messageId?: string;
	profileName?: string;
}

function inbound(overrides: InboundOverrides = {}) {
	return {
		type: 'whatsapp.message.received',
		data: {
			to: BIZ,
			from: SENDER,
			text: 'Hi there',
			messageId: 'wamid.001',
			profileName: 'Dana',
			...overrides,
		},
	};
}

function sender(app: FastifyInstance): RecordingWhatsappSender {
	return app.deps.whatsappSender as RecordingWhatsappSender;
}

/** Build an app + repos and enable WhatsApp on the signed-up owner's account. */
async function setup() {
	const { app, repos } = await buildTestAppWithRepos();
	const owner = await signupOwner(app);
	const accountId = owner.account.id as AccountId;
	await repos.accounts.setChannelConfig(accountId, 'whatsapp', {
		enabled: true,
		address: BIZ,
		providerRef: 'zwa_1',
	});
	return { app, repos, accountId, owner };
}

describe('POST /v1/channels/whatsapp/inbound', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('ignores a message to a number no account has provisioned', async () => {
		const built = await setup();
		app = built.app;
		const res = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inbound({ to: '+15557778888' }),
		});
		expect(res.json()).toEqual({ handled: false, outcome: 'unknown_account' });
	});

	it('acknowledges without replying when the channel is disabled', async () => {
		const { app: built, repos, accountId } = await setup();
		app = built;
		await repos.accounts.setChannelConfig(accountId, 'whatsapp', {
			enabled: false,
			address: BIZ,
			providerRef: 'zwa_1',
		});
		const res = await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: inbound() });
		expect(res.json()).toEqual({ handled: false, outcome: 'channel_disabled' });
		expect(sender(app).messages).toHaveLength(0);
	});

	it('sends an unknown sender a signup link prefilled with their phone', async () => {
		const built = await setup();
		app = built.app;
		const res = await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: inbound() });
		expect(res.json()).toEqual({ handled: true, outcome: 'send_signup_link' });
		const sent = sender(app).messages.at(-1);
		expect(sent?.from).toBe(BIZ);
		expect(sent?.to).toBe(SENDER);
		expect(sent?.text).toContain(`phone=${encodeURIComponent(SENDER)}`);
	});

	it('offers slots to a recognized customer whose CRM phone is free text', async () => {
		const { app: built, repos, accountId } = await setup();
		app = built;
		await repos.customers.create(accountId, {
			name: 'Dana Fox',
			email: '',
			phone: '(555) 999-0000',
			address: '12 Pine St',
			lifetimeValue: 0,
			balance: 0,
			notes: '',
		});
		const res = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inbound({ text: 'When are you free?' }),
		});
		expect(res.json()).toEqual({ handled: true, outcome: 'offer_slots' });
		expect(sender(app).messages.at(-1)?.text).toContain('1.');
	});

	it('books the job when the customer picks an offered slot', async () => {
		const { app: built, repos, accountId } = await setup();
		app = built;
		await repos.customers.create(accountId, {
			name: 'Dana Fox',
			email: '',
			phone: '+1 (555) 999-0000',
			address: '12 Pine St',
			lifetimeValue: 0,
			balance: 0,
			notes: '',
		});
		await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inbound({ text: 'When are you free?', messageId: 'wamid.a' }),
		});
		const res = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inbound({ text: '1', messageId: 'wamid.b' }),
		});
		expect(res.json()).toEqual({ handled: true, outcome: 'book' });
		const { total } = await repos.jobs.list({ accountId, page: 1, pageSize: 10 });
		expect(total).toBe(1);
		const thread = await repos.agentThreads.findByContact(accountId, 'whatsapp', SENDER);
		const messages = thread
			? await repos.conversations.listMessages(accountId, thread.conversationId)
			: [];
		expect(messages?.some((m) => m.author === 'note' && m.body.includes('Rivus booked'))).toBe(
			true,
		);
	});

	it('ignores an exact redelivery of an already-processed message', async () => {
		const built = await setup();
		app = built.app;
		const first = await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: inbound() });
		expect(first.json()).toEqual({ handled: true, outcome: 'send_signup_link' });
		const second = await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: inbound() });
		expect(second.json()).toEqual({ handled: false, outcome: 'duplicate_delivery' });
	});

	it('rolls back a booking when the WhatsApp send fails, and returns 5xx', async () => {
		const { app: built, repos, accountId } = await setup();
		app = built;
		await repos.customers.create(accountId, {
			name: 'Dana Fox',
			email: '',
			phone: '(555) 999-0000',
			address: '',
			lifetimeValue: 0,
			balance: 0,
			notes: '',
		});
		await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inbound({ text: 'When are you free?', messageId: 'wamid.a' }),
		});
		sender(app).failNext = true;
		const res = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inbound({ text: '1', messageId: 'wamid.b' }),
		});
		expect(res.statusCode).toBeGreaterThanOrEqual(500);
		const { total } = await repos.jobs.list({ accountId, page: 1, pageSize: 10 });
		expect(total).toBe(0);
	});

	it('refuses to converse with any account’s own business number (loop guard)', async () => {
		const built = await setup();
		app = built.app;
		const res = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inbound({ from: BIZ }),
		});
		expect(res.json()).toEqual({ handled: false, outcome: 'own_number' });
	});

	it('declines a non-text message', async () => {
		const built = await setup();
		app = built.app;
		const res = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inbound({ text: '' }),
		});
		expect(res.json()).toEqual({ handled: false, outcome: 'unsupported_message_type' });
	});

	it('flags the conversation on a delivery failure, and is idempotent', async () => {
		const built = await setup();
		app = built.app;
		// Open a thread first (an unknown sender gets a signup link).
		await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: inbound() });
		const failure = {
			type: 'whatsapp.message.failed',
			data: { from: BIZ, to: SENDER, reason: 'undeliverable' },
		};
		const first = await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: failure });
		expect(first.json()).toEqual({ handled: true, outcome: 'delivery_failed' });
		const second = await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: failure });
		expect(second.json()).toEqual({ handled: false, outcome: 'already_flagged' });
	});

	it('keeps two accounts’ numbers isolated', async () => {
		const { app: built, repos } = await setup();
		app = built;
		// A second account with a different business number.
		const other = await signupOwner(app);
		await repos.accounts.setChannelConfig(other.account.id as AccountId, 'whatsapp', {
			enabled: true,
			address: '+15552223333',
			providerRef: 'zwa_2',
		});
		const res = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inbound({ to: '+15552223333', from: '+15558887777' }),
		});
		// Resolves to the OTHER account (not the first), and handles it there.
		expect(res.json()).toEqual({ handled: true, outcome: 'send_signup_link' });
		expect(sender(app).messages.at(-1)?.from).toBe('+15552223333');
	});
});

// --- Signature + handshake (separate config) --------------------------------

const SECRET = 'zwh_test_secret';

function buildWhatsappApp(extraConfig: Record<string, string> = {}): FastifyInstance {
	const repos = createInMemoryRepositories();
	return buildApp({
		config: loadConfig({
			NODE_ENV: 'test',
			JWT_SECRET: 'test-secret-value-1234',
			...extraConfig,
		} as NodeJS.ProcessEnv),
		...repos,
		mailer: new RecordingMailer(),
		receivedEmails: new NoopReceivedEmailReader(),
		whatsappSender: new RecordingWhatsappSender(),
		whatsappProvisioner: new NoopChannelProvisioner(),
		smsSender: new RecordingSmsSender(),
		smsProvisioner: new NoopChannelProvisioner(),
		notifier: createNotificationService({ notifications: repos.notifications }),
		faqSimilarity: new NoopFaqSimilarityService(),
		faqAnswer: new NoopFaqAnswerService(),
		ping: async () => ({ ready: true }),
	});
}

describe('POST /v1/channels/whatsapp/inbound — signature + handshake', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('accepts a validly signed delivery and rejects a tampered one', async () => {
		app = buildWhatsappApp({ ZERNIO_WEBHOOK_SECRET: SECRET });
		const body = JSON.stringify(inbound({ to: '+19998887777' }));
		const headers = {
			'content-type': 'application/json',
			'x-zernio-signature': signZernioPayload(SECRET, body),
		};
		const ok = await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: body, headers });
		// Unknown account, but the signature passed (a 401 would mean it didn't).
		expect(ok.json()).toEqual({ handled: false, outcome: 'unknown_account' });

		const tampered = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: JSON.stringify(inbound({ text: 'changed' })),
			headers,
		});
		expect(tampered.statusCode).toBe(401);
	});

	it('accepts the legacy X-Late-Signature header', async () => {
		app = buildWhatsappApp({ ZERNIO_WEBHOOK_SECRET: SECRET });
		const body = JSON.stringify(inbound({ to: '+19998887777' }));
		const res = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: body,
			headers: {
				'content-type': 'application/json',
				'x-late-signature': signZernioPayload(SECRET, body),
			},
		});
		expect(res.json()).toEqual({ handled: false, outcome: 'unknown_account' });
	});

	it('rejects a delivery with no signature header (401)', async () => {
		app = buildWhatsappApp({ ZERNIO_WEBHOOK_SECRET: SECRET });
		const res = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: JSON.stringify(inbound()),
			headers: { 'content-type': 'application/json' },
		});
		expect(res.statusCode).toBe(401);
	});

	it('refuses to serve unsigned in production (503, fail closed)', async () => {
		app = buildWhatsappApp({
			NODE_ENV: 'production',
			JWT_SECRET: 'x'.repeat(32),
			RESEND_API_KEY: 're_test_key',
			LOG_LEVEL: 'silent',
			CORS_ORIGIN: 'https://app.rivus.ai',
		});
		const res = await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: inbound() });
		expect(res.statusCode).toBe(503);
	});

	it('echoes the challenge when the verify token matches, else 404s', async () => {
		app = buildWhatsappApp({ ZERNIO_VERIFY_TOKEN: 'verify-me' });
		const ok = await app.inject({
			method: 'GET',
			url: `${WEBHOOK_URL}?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=echo123`,
		});
		expect(ok.statusCode).toBe(200);
		expect(ok.body).toBe('echo123');

		const bad = await app.inject({
			method: 'GET',
			url: `${WEBHOOK_URL}?hub.verify_token=wrong&hub.challenge=echo123`,
		});
		expect(bad.statusCode).toBe(404);
	});
});

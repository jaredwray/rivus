import type { AccountId } from '@rivus/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createInMemoryRepositories } from '../src/repositories/memory';
import { NoopReceivedEmailReader } from '../src/services/agent/email/received';
import { NoopChannelProvisioner, NoopNumberReleaser } from '../src/services/channel-provisioning';
import { createDecider } from '../src/services/chat/decide';
import { NoopFaqAnswerService } from '../src/services/faq-answer';
import { NoopFaqSimilarityService } from '../src/services/faq-similarity';
import { createNotificationService } from '../src/services/notifications';
import { signPlivoUrl } from '../src/services/plivo';
import { createWebsiteAuditService } from '../src/services/website-audit';
import {
	buildTestAppWithRepos,
	RecordingMailer,
	RecordingSmsSender,
	RecordingWhatsappSender,
	signupOwner,
} from './helpers';

const WEBHOOK_URL = '/v1/channels/sms/plivo/inbound';
// The account's number is stored `+`-formed; Plivo delivers bare digits.
const BIZ = '+15550002222';
const BIZ_PLIVO = '15550002222';
const SENDER = '+15559990000';
const SENDER_PLIVO = '15559990000';

/** A Plivo-shaped inbound SMS delivery (SMS payloads carry `Text`, no ContentType). */
function inbound(overrides: Record<string, string> = {}) {
	return {
		From: SENDER_PLIVO,
		To: BIZ_PLIVO,
		Type: 'sms',
		Text: 'Hi there',
		MessageUUID: 'plivo-sms-001',
		...overrides,
	};
}

function sender(app: FastifyInstance): RecordingSmsSender {
	return app.deps.smsSender as RecordingSmsSender;
}

/** Build an app + repos and enable SMS on the signed-up owner's account. */
async function setup() {
	const { app, repos } = await buildTestAppWithRepos();
	const owner = await signupOwner(app);
	const accountId = owner.account.id as AccountId;
	await repos.accounts.setChannelConfig(accountId, 'sms', {
		enabled: true,
		address: BIZ,
		providerRef: BIZ_PLIVO,
	});
	return { app, repos, accountId, owner };
}

describe('POST /v1/channels/sms/plivo/inbound', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('ignores a text to a number no account has provisioned', async () => {
		const built = await setup();
		app = built.app;
		const res = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inbound({ To: '15557778888' }),
		});
		expect(res.json()).toEqual({ handled: false, outcome: 'unknown_account' });
	});

	it('acknowledges without replying when the channel is disabled', async () => {
		const { app: built, repos, accountId } = await setup();
		app = built;
		await repos.accounts.setChannelConfig(accountId, 'sms', {
			enabled: false,
			address: BIZ,
			providerRef: BIZ_PLIVO,
		});
		const res = await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: inbound() });
		expect(res.json()).toEqual({ handled: false, outcome: 'channel_disabled' });
		expect(sender(app).messages).toHaveLength(0);
	});

	it('sends an unknown sender a signup link prefilled with their phone, over SMS', async () => {
		const built = await setup();
		app = built.app;
		const res = await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: inbound() });
		expect(res.json()).toEqual({ handled: true, outcome: 'send_signup_link' });
		const sent = sender(app).messages.at(-1);
		expect(sent?.from).toBe(BIZ);
		expect(sent?.to).toBe(SENDER);
		expect(sent?.text).toContain(`phone=${encodeURIComponent(SENDER)}`);
		// The reply left over SMS, not WhatsApp.
		expect((app.deps.whatsappSender as RecordingWhatsappSender).messages).toHaveLength(0);
	});

	it('books a slot for a recognized customer over two texts', async () => {
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
		const offer = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inbound({ Text: 'When are you free?', MessageUUID: 'plivo-sms-a' }),
		});
		expect(offer.json()).toEqual({ handled: true, outcome: 'offer_slots' });
		expect(sender(app).messages.at(-1)?.text).toContain('1.');
		const book = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inbound({ Text: '1', MessageUUID: 'plivo-sms-b' }),
		});
		expect(book.json()).toEqual({ handled: true, outcome: 'book' });
		const { total } = await repos.jobs.list({ accountId, page: 1, pageSize: 10 });
		expect(total).toBe(1);
		const thread = await repos.agentThreads.findByContact(accountId, 'sms', SENDER);
		expect(thread).not.toBeNull();
	});

	it('accepts the form-encoded variant', async () => {
		const built = await setup();
		app = built.app;
		const body = new URLSearchParams({
			From: SENDER_PLIVO,
			To: BIZ_PLIVO,
			Type: 'sms',
			Text: 'Hi there',
			MessageUUID: 'plivo-sms-form',
		});
		const res = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: body.toString(),
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
		});
		expect(res.json()).toEqual({ handled: true, outcome: 'send_signup_link' });
		expect(sender(app).messages.at(-1)?.to).toBe(SENDER);
	});

	it('ignores an exact redelivery of an already-processed text', async () => {
		const built = await setup();
		app = built.app;
		const first = await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: inbound() });
		expect(first.json()).toEqual({ handled: true, outcome: 'send_signup_link' });
		const second = await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: inbound() });
		expect(second.json()).toEqual({ handled: false, outcome: 'duplicate_delivery' });
	});

	it('refuses to converse with any account’s own SMS number (loop guard)', async () => {
		const built = await setup();
		app = built.app;
		const res = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inbound({ From: BIZ_PLIVO }),
		});
		expect(res.json()).toEqual({ handled: false, outcome: 'own_number' });
	});

	it('declines an MMS (no text body)', async () => {
		const built = await setup();
		app = built.app;
		const res = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inbound({ Type: 'mms', Text: '' }),
		});
		// An mms-typed delivery is not this hook's channel: recognized, ignored.
		expect(res.json()).toEqual({ handled: false, outcome: 'ignored_event_type' });

		const empty = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inbound({ Text: '' }),
		});
		expect(empty.json()).toEqual({ handled: false, outcome: 'unsupported_message_type' });
	});

	it('ignores a WhatsApp message on the SMS hook', async () => {
		const built = await setup();
		app = built.app;
		const res = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inbound({ Type: 'whatsapp' }),
		});
		expect(res.json()).toEqual({ handled: false, outcome: 'ignored_event_type' });
	});

	it('keeps the SMS and WhatsApp threads separate when both share one number', async () => {
		const { app: built, repos, accountId } = await setup();
		app = built;
		// The same number provisioned on WhatsApp too (the shared-number setup).
		await repos.accounts.setChannelConfig(accountId, 'whatsapp', {
			enabled: true,
			address: BIZ,
			providerRef: BIZ_PLIVO,
		});
		const res = await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: inbound() });
		expect(res.json()).toEqual({ handled: true, outcome: 'send_signup_link' });
		// The inbound text landed on the SMS channel: an sms thread, an SMS reply.
		expect(await repos.agentThreads.findByContact(accountId, 'sms', SENDER)).not.toBeNull();
		expect(await repos.agentThreads.findByContact(accountId, 'whatsapp', SENDER)).toBeNull();
		expect(sender(app).messages).toHaveLength(1);
		expect((app.deps.whatsappSender as RecordingWhatsappSender).messages).toHaveLength(0);
	});

	it('flags the conversation when a delivery report says undelivered, ignores the rest', async () => {
		const built = await setup();
		app = built.app;
		await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: inbound() });
		const sent = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: { From: BIZ_PLIVO, To: SENDER_PLIVO, Status: 'sent', MessageUUID: 'm-out-1' },
		});
		expect(sent.json()).toEqual({ handled: false, outcome: 'ignored_event_type' });
		const failed = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: {
				From: BIZ_PLIVO,
				To: SENDER_PLIVO,
				Status: 'undelivered',
				ErrorCode: '30005',
				MessageUUID: 'm-out-1',
			},
		});
		expect(failed.json()).toEqual({ handled: true, outcome: 'delivery_failed' });
	});
});

// --- Signature (separate config) ---------------------------------------------

const AUTH_TOKEN = 'plivo-test-auth-token';
const PINNED_URL = 'https://api.rivus.ai/v1/channels/sms/plivo/inbound';

function buildSmsApp(extraConfig: Record<string, string> = {}): FastifyInstance {
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
		numberReleaser: new NoopNumberReleaser(),
		notifier: createNotificationService({ notifications: repos.notifications }),
		faqSimilarity: new NoopFaqSimilarityService(),
		faqAnswer: new NoopFaqAnswerService(),
		chatDecider: createDecider(),
		websiteAudit: createWebsiteAuditService({}),
		ping: async () => ({ ready: true }),
	});
}

describe('POST /v1/channels/sms/plivo/inbound — signature', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('accepts a delivery signed for the pinned SMS webhook URL and rejects the rest', async () => {
		app = buildSmsApp({ PLIVO_AUTH_TOKEN: AUTH_TOKEN, PLIVO_SMS_WEBHOOK_URL: PINNED_URL });
		const nonce = '2468013579';
		const headers = {
			'x-plivo-signature-v2-nonce': nonce,
			'x-plivo-signature-v2': signPlivoUrl({ authToken: AUTH_TOKEN, url: PINNED_URL, nonce }),
		};
		const ok = await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: inbound(), headers });
		// Unknown account, but the signature passed (a 401 would mean it didn't).
		expect(ok.json()).toEqual({ handled: false, outcome: 'unknown_account' });

		const unsigned = await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: inbound() });
		expect(unsigned.statusCode).toBe(401);

		// A signature minted for the WhatsApp hook's URL never opens the SMS hook.
		const crossChannel = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inbound(),
			headers: {
				'x-plivo-signature-v2-nonce': nonce,
				'x-plivo-signature-v2': signPlivoUrl({
					authToken: AUTH_TOKEN,
					url: 'https://api.rivus.ai/v1/channels/whatsapp/plivo/inbound',
					nonce,
				}),
			},
		});
		expect(crossChannel.statusCode).toBe(401);
	});

	it('derives the signed URL from forwarding headers when none is pinned', async () => {
		app = buildSmsApp({ PLIVO_AUTH_TOKEN: AUTH_TOKEN });
		const nonce = '1357924680';
		const res = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inbound(),
			headers: {
				'x-forwarded-proto': 'https',
				'x-forwarded-host': 'api.rivus.ai',
				'x-plivo-signature-v2-nonce': nonce,
				'x-plivo-signature-v2': signPlivoUrl({ authToken: AUTH_TOKEN, url: PINNED_URL, nonce }),
			},
		});
		expect(res.json()).toEqual({ handled: false, outcome: 'unknown_account' });
	});

	it('stays open when unconfigured outside production, and 503s in production', async () => {
		app = buildSmsApp();
		const open = await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: inbound() });
		expect(open.json()).toEqual({ handled: false, outcome: 'unknown_account' });
		await app.close();

		app = buildSmsApp({
			NODE_ENV: 'production',
			JWT_SECRET: 'x'.repeat(32),
			RESEND_API_KEY: 're_test_key',
			LOG_LEVEL: 'silent',
			CORS_ORIGIN: 'https://app.rivus.ai',
		});
		const res = await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: inbound() });
		expect(res.statusCode).toBe(503);
	});
});

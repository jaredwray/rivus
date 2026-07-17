import type { AccountId } from '@rivus/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createInMemoryRepositories } from '../src/repositories/memory';
import { NoopReceivedEmailReader } from '../src/services/agent/email/received';
import { type PlivoInboundResult, parsePlivoInbound } from '../src/services/agent/plivo-inbound';
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

const WEBHOOK_URL = '/v1/channels/whatsapp/plivo/inbound';
// The account's business number is stored `+`-formed; Plivo delivers bare digits.
const BIZ = '+15550001111';
const BIZ_PLIVO = '15550001111';
const SENDER = '+15559990000';
const SENDER_PLIVO = '15559990000';

/** A Plivo-shaped inbound WhatsApp text delivery. */
function inbound(overrides: Record<string, string> = {}) {
	return {
		From: SENDER_PLIVO,
		To: BIZ_PLIVO,
		Type: 'whatsapp',
		ContentType: 'text',
		Body: 'Hi there',
		MessageUUID: 'plivo-msg-001',
		ProfileName: 'Dana',
		...overrides,
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
		providerRef: BIZ_PLIVO,
	});
	return { app, repos, accountId, owner };
}

describe('POST /v1/channels/whatsapp/plivo/inbound', () => {
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
			payload: inbound({ To: '15557778888' }),
		});
		expect(res.json()).toEqual({ handled: false, outcome: 'unknown_account' });
	});

	it('acknowledges without replying when the channel is disabled', async () => {
		const { app: built, repos, accountId } = await setup();
		app = built;
		await repos.accounts.setChannelConfig(accountId, 'whatsapp', {
			enabled: false,
			address: BIZ,
			providerRef: BIZ_PLIVO,
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

	it('books a slot for a recognized customer over two Plivo turns', async () => {
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
			payload: inbound({ Body: 'When are you free?', MessageUUID: 'plivo-msg-a' }),
		});
		expect(offer.json()).toEqual({ handled: true, outcome: 'offer_slots' });
		expect(sender(app).messages.at(-1)?.text).toContain('1.');
		const book = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inbound({ Body: '1', MessageUUID: 'plivo-msg-b' }),
		});
		expect(book.json()).toEqual({ handled: true, outcome: 'book' });
		const { total } = await repos.jobs.list({ accountId, page: 1, pageSize: 10 });
		expect(total).toBe(1);
	});

	it('accepts Plivo’s form-encoded variant (SMS-shaped Text field)', async () => {
		const built = await setup();
		app = built.app;
		const body = new URLSearchParams({
			From: SENDER_PLIVO,
			To: BIZ_PLIVO,
			Type: 'whatsapp',
			Text: 'Hi there',
			MessageUUID: 'plivo-msg-form',
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

	it('ignores an exact redelivery of an already-processed message', async () => {
		const built = await setup();
		app = built.app;
		const first = await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: inbound() });
		expect(first.json()).toEqual({ handled: true, outcome: 'send_signup_link' });
		const second = await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: inbound() });
		expect(second.json()).toEqual({ handled: false, outcome: 'duplicate_delivery' });
	});

	it('refuses to converse with any account’s own business number (loop guard)', async () => {
		const built = await setup();
		app = built.app;
		const res = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inbound({ From: BIZ_PLIVO }),
		});
		expect(res.json()).toEqual({ handled: false, outcome: 'own_number' });
	});

	it('declines media, location, and button deliveries (text only)', async () => {
		const built = await setup();
		app = built.app;
		const res = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inbound({ ContentType: 'media', Body: '' }),
		});
		expect(res.json()).toEqual({ handled: false, outcome: 'unsupported_message_type' });
	});

	it('ignores a non-WhatsApp (SMS) message on the hook', async () => {
		const built = await setup();
		app = built.app;
		const res = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inbound({ Type: 'sms' }),
		});
		expect(res.json()).toEqual({ handled: false, outcome: 'ignored_event_type' });
	});

	it('answers unrecognized payloads with 200 (never a retry storm)', async () => {
		const built = await setup();
		app = built.app;
		const res = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: { hello: 'world' },
		});
		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({ handled: false, outcome: 'unrecognized_payload' });
	});

	it('flags the conversation when a delivery report says failed, ignores the rest', async () => {
		const built = await setup();
		app = built.app;
		// Open a thread first (an unknown sender gets a signup link).
		await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: inbound() });
		const delivered = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: { From: BIZ_PLIVO, To: SENDER_PLIVO, Status: 'delivered', MessageUUID: 'm-out-1' },
		});
		expect(delivered.json()).toEqual({ handled: false, outcome: 'ignored_event_type' });
		const failed = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: {
				From: BIZ_PLIVO,
				To: SENDER_PLIVO,
				Status: 'failed',
				ErrorCode: 30008,
				MessageUUID: 'm-out-1',
			},
		});
		expect(failed.json()).toEqual({ handled: true, outcome: 'delivery_failed' });
	});
});

// --- Signature (separate config) ---------------------------------------------

const AUTH_TOKEN = 'plivo-test-auth-token';
const PINNED_URL = 'https://api.rivus.ai/v1/channels/whatsapp/plivo/inbound';

function buildPlivoApp(extraConfig: Record<string, string> = {}): FastifyInstance {
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

describe('POST /v1/channels/whatsapp/plivo/inbound — signature', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('accepts a delivery signed for the pinned webhook URL and rejects the rest', async () => {
		app = buildPlivoApp({ PLIVO_AUTH_TOKEN: AUTH_TOKEN, PLIVO_WEBHOOK_URL: PINNED_URL });
		const nonce = '12345678901234567890';
		const headers = {
			'x-plivo-signature-v2-nonce': nonce,
			'x-plivo-signature-v2': signPlivoUrl({ authToken: AUTH_TOKEN, url: PINNED_URL, nonce }),
		};
		const ok = await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: inbound(), headers });
		// Unknown account, but the signature passed (a 401 would mean it didn't).
		expect(ok.json()).toEqual({ handled: false, outcome: 'unknown_account' });

		const wrongNonce = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inbound(),
			headers: { ...headers, 'x-plivo-signature-v2-nonce': 'different-nonce' },
		});
		expect(wrongNonce.statusCode).toBe(401);

		const unsigned = await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: inbound() });
		expect(unsigned.statusCode).toBe(401);
	});

	it('accepts the main-account signature header', async () => {
		app = buildPlivoApp({ PLIVO_AUTH_TOKEN: AUTH_TOKEN, PLIVO_WEBHOOK_URL: PINNED_URL });
		const nonce = '888777666555';
		const res = await app.inject({
			method: 'POST',
			url: WEBHOOK_URL,
			payload: inbound(),
			headers: {
				'x-plivo-signature-v2-nonce': nonce,
				'x-plivo-signature-ma-v2': signPlivoUrl({ authToken: AUTH_TOKEN, url: PINNED_URL, nonce }),
			},
		});
		expect(res.json()).toEqual({ handled: false, outcome: 'unknown_account' });
	});

	it('derives the signed URL from forwarding headers when none is pinned', async () => {
		app = buildPlivoApp({ PLIVO_AUTH_TOKEN: AUTH_TOKEN });
		const nonce = '424242424242';
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

	it('ignores the query string when verifying (Plivo signs the base URL)', async () => {
		app = buildPlivoApp({ PLIVO_AUTH_TOKEN: AUTH_TOKEN });
		const nonce = '10101010';
		const res = await app.inject({
			method: 'POST',
			url: `${WEBHOOK_URL}?utm=plivo`,
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
		app = buildPlivoApp();
		const open = await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: inbound() });
		expect(open.json()).toEqual({ handled: false, outcome: 'unknown_account' });
		await app.close();

		app = buildPlivoApp({
			NODE_ENV: 'production',
			JWT_SECRET: 'x'.repeat(32),
			RESEND_API_KEY: 're_test_key',
			LOG_LEVEL: 'silent',
			CORS_ORIGIN: 'https://app.rivus.ai',
		});
		const res = await app.inject({ method: 'POST', url: WEBHOOK_URL, payload: inbound() });
		expect(res.statusCode).toBe(503);
	});

	it('503s in production on a partial credential pair (token without auth id)', async () => {
		// The sender would be a no-op: verifying and "handling" deliveries would
		// acknowledge messages into a black hole, so the route must refuse instead.
		app = buildPlivoApp({
			NODE_ENV: 'production',
			JWT_SECRET: 'x'.repeat(32),
			RESEND_API_KEY: 're_test_key',
			LOG_LEVEL: 'silent',
			CORS_ORIGIN: 'https://app.rivus.ai',
			PLIVO_AUTH_TOKEN: AUTH_TOKEN,
		});
		const nonce = '31337';
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
		expect(res.statusCode).toBe(503);
	});
});

// --- Payload mapping edges the route tests don't reach ------------------------

describe('parsePlivoInbound', () => {
	function kind(result: PlivoInboundResult): string {
		return result.kind;
	}

	it('maps SMS-shaped payloads (Text, no ContentType) to a text message', () => {
		const result = parsePlivoInbound(
			{ From: SENDER_PLIVO, To: BIZ_PLIVO, Text: 'hello' },
			'whatsapp',
		);
		expect(result).toEqual({
			kind: 'event',
			event: {
				type: 'whatsapp.message.received',
				data: { to: BIZ, from: SENDER, text: 'hello', messageId: '', profileName: '' },
			},
		});
	});

	it('keeps `+`-formed numbers and stringifies numeric MessageUUIDs', () => {
		const result = parsePlivoInbound(
			{
				From: SENDER,
				To: BIZ,
				Body: 'hi',
				MessageUUID: 12345,
			},
			'whatsapp',
		);
		expect(result).toEqual({
			kind: 'event',
			event: {
				type: 'whatsapp.message.received',
				data: { to: BIZ, from: SENDER, text: 'hi', messageId: '12345', profileName: '' },
			},
		});
	});

	it('uses the status as the failure reason when there is no error code', () => {
		const result = parsePlivoInbound(
			{ From: BIZ_PLIVO, To: SENDER_PLIVO, Status: 'undelivered' },
			'whatsapp',
		);
		expect(result).toEqual({
			kind: 'event',
			event: {
				type: 'whatsapp.message.failed',
				data: { from: BIZ, to: SENDER, reason: 'undelivered' },
			},
		});
	});

	it('ignores in-flight and successful delivery reports', () => {
		for (const status of ['queued', 'sent', 'delivered', 'read', 'SENT']) {
			expect(
				kind(parsePlivoInbound({ From: BIZ_PLIVO, To: SENDER_PLIVO, Status: status }, 'whatsapp')),
			).toBe('ignored');
		}
	});

	it('rejects non-object and number-less payloads', () => {
		expect(kind(parsePlivoInbound('a string', 'whatsapp'))).toBe('unrecognized');
		expect(kind(parsePlivoInbound(null, 'whatsapp'))).toBe('unrecognized');
		expect(kind(parsePlivoInbound({ From: 'garbage', To: BIZ_PLIVO, Body: 'x' }, 'whatsapp'))).toBe(
			'unrecognized',
		);
		expect(kind(parsePlivoInbound({ From: SENDER_PLIVO, Body: 'x' }, 'whatsapp'))).toBe(
			'unrecognized',
		);
	});
});

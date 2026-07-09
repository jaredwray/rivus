import type { AccountId } from '@rivus/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createInMemoryRepositories } from '../src/repositories/memory';
import { NoopReceivedEmailReader } from '../src/services/agent/email/received';
import { parseTwilioInbound, type TwilioInboundResult } from '../src/services/agent/twilio-inbound';
import { NoopChannelProvisioner } from '../src/services/channel-provisioning';
import { NoopFaqAnswerService } from '../src/services/faq-answer';
import { NoopFaqSimilarityService } from '../src/services/faq-similarity';
import { createNotificationService } from '../src/services/notifications';
import { signTwilioRequest } from '../src/services/twilio';
import {
	buildTestAppWithRepos,
	RecordingMailer,
	RecordingSmsSender,
	RecordingWhatsappSender,
	signupOwner,
} from './helpers';

const WHATSAPP_URL = '/v1/channels/whatsapp/twilio/inbound';
const SMS_URL = '/v1/channels/sms/twilio/inbound';
const BIZ = '+15550001111';
const SENDER = '+15559990000';
const NUMBER_SID = 'PN0123456789abcdef0123456789abcdef';
const EMPTY_TWIML = '<Response/>';

/** Twilio's WhatsApp address form. */
function wa(number: string): string {
	return `whatsapp:${number}`;
}

/** A Twilio-shaped inbound WhatsApp message, as the form parser presents it. */
function inboundWhatsapp(overrides: Record<string, string> = {}) {
	return {
		From: wa(SENDER),
		To: wa(BIZ),
		Body: 'Hi there',
		MessageSid: 'SMinbound001',
		ProfileName: 'Dana',
		NumMedia: '0',
		...overrides,
	};
}

/** A Twilio-shaped inbound SMS. */
function inboundSms(overrides: Record<string, string> = {}) {
	return {
		From: SENDER,
		To: BIZ,
		Body: 'Hi there',
		MessageSid: 'SMinbound001',
		...overrides,
	};
}

function whatsappSender(app: FastifyInstance): RecordingWhatsappSender {
	return app.deps.whatsappSender as RecordingWhatsappSender;
}

function smsSender(app: FastifyInstance): RecordingSmsSender {
	return app.deps.smsSender as RecordingSmsSender;
}

/** Build an app + repos and enable a Twilio-owned number on the owner's account. */
async function setup(channel: 'whatsapp' | 'sms') {
	const { app, repos } = await buildTestAppWithRepos();
	const owner = await signupOwner(app);
	const accountId = owner.account.id as AccountId;
	await repos.accounts.setChannelConfig(accountId, channel, {
		enabled: true,
		address: BIZ,
		providerRef: NUMBER_SID,
	});
	return { app, repos, accountId, owner };
}

/** Every Twilio webhook answer is the empty TwiML acknowledgment. */
function expectEmptyTwiml(res: { statusCode: number; body: string; headers: unknown }) {
	expect(res.statusCode).toBe(200);
	expect(res.body).toBe(EMPTY_TWIML);
	expect((res.headers as Record<string, string>)['content-type']).toContain('text/xml');
}

describe('POST /v1/channels/whatsapp/twilio/inbound', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('sends an unknown sender a signup link, threading the number’s providerRef', async () => {
		const built = await setup('whatsapp');
		app = built.app;
		// Twilio posts form-encoded; the route registers the form parser.
		const res = await app.inject({
			method: 'POST',
			url: WHATSAPP_URL,
			payload: new URLSearchParams(inboundWhatsapp()).toString(),
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
		});
		expectEmptyTwiml(res);
		const sent = whatsappSender(app).messages.at(-1);
		expect(sent?.from).toBe(BIZ);
		expect(sent?.to).toBe(SENDER);
		expect(sent?.text).toContain(`phone=${encodeURIComponent(SENDER)}`);
		// The reply carries the sending number's fingerprint so the outbound
		// router sends it through Twilio, the number's owner.
		expect(sent?.providerRef).toBe(NUMBER_SID);
	});

	it('books a slot for a recognized customer over two turns', async () => {
		const { app: built, repos, accountId } = await setup('whatsapp');
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
			url: WHATSAPP_URL,
			payload: new URLSearchParams(
				inboundWhatsapp({ Body: 'When are you free?', MessageSid: 'SMa' }),
			).toString(),
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
		});
		expectEmptyTwiml(offer);
		expect(whatsappSender(app).messages.at(-1)?.text).toContain('1.');
		const book = await app.inject({
			method: 'POST',
			url: WHATSAPP_URL,
			payload: new URLSearchParams(inboundWhatsapp({ Body: '1', MessageSid: 'SMb' })).toString(),
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
		});
		expectEmptyTwiml(book);
		const { total } = await repos.jobs.list({ accountId, page: 1, pageSize: 10 });
		expect(total).toBe(1);
	});

	it('ignores an exact redelivery of an already-processed MessageSid', async () => {
		const built = await setup('whatsapp');
		app = built.app;
		await app.inject({ method: 'POST', url: WHATSAPP_URL, payload: inboundWhatsapp() });
		expect(whatsappSender(app).messages).toHaveLength(1);
		const second = await app.inject({
			method: 'POST',
			url: WHATSAPP_URL,
			payload: inboundWhatsapp(),
		});
		expectEmptyTwiml(second);
		// The duplicate is acknowledged without a second reply.
		expect(whatsappSender(app).messages).toHaveLength(1);
	});

	it('acknowledges without replying when the channel is disabled or the number unknown', async () => {
		const { app: built, repos, accountId } = await setup('whatsapp');
		app = built;
		const unknown = await app.inject({
			method: 'POST',
			url: WHATSAPP_URL,
			payload: inboundWhatsapp({ To: wa('+15557778888') }),
		});
		expectEmptyTwiml(unknown);
		await repos.accounts.setChannelConfig(accountId, 'whatsapp', {
			enabled: false,
			address: BIZ,
			providerRef: NUMBER_SID,
		});
		const disabled = await app.inject({
			method: 'POST',
			url: WHATSAPP_URL,
			payload: inboundWhatsapp(),
		});
		expectEmptyTwiml(disabled);
		expect(whatsappSender(app).messages).toHaveLength(0);
	});

	it('refuses to converse with any account’s own business number (loop guard)', async () => {
		const built = await setup('whatsapp');
		app = built.app;
		const res = await app.inject({
			method: 'POST',
			url: WHATSAPP_URL,
			payload: inboundWhatsapp({ From: wa(BIZ) }),
		});
		expectEmptyTwiml(res);
		expect(whatsappSender(app).messages).toHaveLength(0);
	});

	it('declines media-only messages (text only) without replying', async () => {
		const built = await setup('whatsapp');
		app = built.app;
		const res = await app.inject({
			method: 'POST',
			url: WHATSAPP_URL,
			payload: inboundWhatsapp({ Body: '', NumMedia: '1' }),
		});
		expectEmptyTwiml(res);
		expect(whatsappSender(app).messages).toHaveLength(0);
	});

	it('ignores an SMS-shaped delivery (bare addresses) on the WhatsApp hook', async () => {
		const built = await setup('whatsapp');
		app = built.app;
		const res = await app.inject({
			method: 'POST',
			url: WHATSAPP_URL,
			payload: inboundSms(),
		});
		expectEmptyTwiml(res);
		expect(whatsappSender(app).messages).toHaveLength(0);
	});

	it('acknowledges with empty TwiML even when dispatch fails (Twilio never redelivers)', async () => {
		const { app: built, repos } = await setup('whatsapp');
		app = built;
		vi.spyOn(repos.accounts, 'findByChannelAddress').mockRejectedValueOnce(new Error('db down'));
		const res = await app.inject({
			method: 'POST',
			url: WHATSAPP_URL,
			payload: inboundWhatsapp(),
		});
		// A 5xx would buy no redelivery from Twilio — the loss is logged instead.
		expectEmptyTwiml(res);
	});

	it('answers unrecognized payloads with the empty TwiML (never a retry storm)', async () => {
		const built = await setup('whatsapp');
		app = built.app;
		const res = await app.inject({
			method: 'POST',
			url: WHATSAPP_URL,
			payload: { hello: 'world' },
		});
		expectEmptyTwiml(res);
	});

	it('flags the conversation when a status callback says failed, ignores the rest', async () => {
		const { app: built, repos, accountId } = await setup('whatsapp');
		app = built;
		// Open a thread first (an unknown sender gets a signup link).
		await app.inject({ method: 'POST', url: WHATSAPP_URL, payload: inboundWhatsapp() });
		const delivered = await app.inject({
			method: 'POST',
			url: WHATSAPP_URL,
			payload: {
				From: wa(BIZ),
				To: wa(SENDER),
				MessageStatus: 'delivered',
				MessageSid: 'SMout1',
			},
		});
		expectEmptyTwiml(delivered);
		const failed = await app.inject({
			method: 'POST',
			url: WHATSAPP_URL,
			payload: new URLSearchParams({
				From: wa(BIZ),
				To: wa(SENDER),
				MessageStatus: 'failed',
				ErrorCode: '63024',
				MessageSid: 'SMout1',
			}).toString(),
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
		});
		expectEmptyTwiml(failed);
		const thread = await repos.agentThreads.findByContact(accountId, 'whatsapp', SENDER);
		const conversation = thread
			? await repos.conversations.findById(accountId, thread.conversationId)
			: null;
		expect(conversation?.status).toBe('needs_attention');
	});
});

describe('POST /v1/channels/sms/twilio/inbound', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('sends an unknown sender a signup link, threading the number’s providerRef', async () => {
		const built = await setup('sms');
		app = built.app;
		const res = await app.inject({
			method: 'POST',
			url: SMS_URL,
			payload: new URLSearchParams(inboundSms()).toString(),
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
		});
		expectEmptyTwiml(res);
		const sent = smsSender(app).messages.at(-1);
		expect(sent?.from).toBe(BIZ);
		expect(sent?.to).toBe(SENDER);
		expect(sent?.providerRef).toBe(NUMBER_SID);
	});

	it('books a slot for a recognized customer over two turns', async () => {
		const { app: built, repos, accountId } = await setup('sms');
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
		await app.inject({
			method: 'POST',
			url: SMS_URL,
			payload: inboundSms({ Body: 'When are you free?', MessageSid: 'SMa' }),
		});
		expect(smsSender(app).messages.at(-1)?.text).toContain('1.');
		await app.inject({
			method: 'POST',
			url: SMS_URL,
			payload: inboundSms({ Body: '1', MessageSid: 'SMb' }),
		});
		const { total } = await repos.jobs.list({ accountId, page: 1, pageSize: 10 });
		expect(total).toBe(1);
	});

	it('ignores a WhatsApp-shaped delivery on the SMS hook', async () => {
		const built = await setup('sms');
		app = built.app;
		const res = await app.inject({
			method: 'POST',
			url: SMS_URL,
			payload: inboundWhatsapp(),
		});
		expectEmptyTwiml(res);
		expect(smsSender(app).messages).toHaveLength(0);
	});

	it('flags the conversation when a status callback says undelivered', async () => {
		const { app: built, repos, accountId } = await setup('sms');
		app = built;
		await app.inject({ method: 'POST', url: SMS_URL, payload: inboundSms() });
		const failed = await app.inject({
			method: 'POST',
			url: SMS_URL,
			payload: { From: BIZ, To: SENDER, MessageStatus: 'undelivered', MessageSid: 'SMout1' },
		});
		expectEmptyTwiml(failed);
		const thread = await repos.agentThreads.findByContact(accountId, 'sms', SENDER);
		const conversation = thread
			? await repos.conversations.findById(accountId, thread.conversationId)
			: null;
		expect(conversation?.status).toBe('needs_attention');
	});
});

// --- Signature (separate config) ---------------------------------------------

const ACCOUNT_SID = 'ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const AUTH_TOKEN = 'twilio-test-auth-token';
const PINNED_URL = 'https://api.rivus.ai/v1/channels/whatsapp/twilio/inbound';

function buildTwilioApp(extraConfig: Record<string, string> = {}): FastifyInstance {
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

/** Sign `params` for `url` and POST them form-encoded with the signature header. */
function signedInject(
	app: FastifyInstance,
	options: {
		url: string;
		signedUrl: string;
		params: Record<string, string>;
		extraHeaders?: Record<string, string>;
		signature?: string;
	},
) {
	return app.inject({
		method: 'POST',
		url: options.url,
		payload: new URLSearchParams(options.params).toString(),
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			'x-twilio-signature':
				options.signature ??
				signTwilioRequest({
					authToken: AUTH_TOKEN,
					url: options.signedUrl,
					params: options.params,
				}),
			...options.extraHeaders,
		},
	});
}

describe('POST /v1/channels/whatsapp/twilio/inbound — signature', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('accepts a delivery signed for the pinned webhook URL and rejects the rest', async () => {
		app = buildTwilioApp({
			TWILIO_ACCOUNT_SID: ACCOUNT_SID,
			TWILIO_AUTH_TOKEN: AUTH_TOKEN,
			TWILIO_WHATSAPP_WEBHOOK_URL: PINNED_URL,
		});
		const params = inboundWhatsapp();
		const ok = await signedInject(app, { url: WHATSAPP_URL, signedUrl: PINNED_URL, params });
		// Unknown account, but the signature passed (a 401 would mean it didn't).
		expect(ok.statusCode).toBe(200);
		expect(ok.body).toBe(EMPTY_TWIML);

		// Twilio signs the form parameters too — a tampered body invalidates it.
		const tamperedParams = await app.inject({
			method: 'POST',
			url: WHATSAPP_URL,
			payload: new URLSearchParams({ ...params, Body: 'tampered' }).toString(),
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
				'x-twilio-signature': signTwilioRequest({
					authToken: AUTH_TOKEN,
					url: PINNED_URL,
					params,
				}),
			},
		});
		expect(tamperedParams.statusCode).toBe(401);

		const badSignature = await signedInject(app, {
			url: WHATSAPP_URL,
			signedUrl: PINNED_URL,
			params,
			signature: 'bm90LXRoZS1zaWduYXR1cmU=',
		});
		expect(badSignature.statusCode).toBe(401);

		const unsigned = await app.inject({
			method: 'POST',
			url: WHATSAPP_URL,
			payload: params,
		});
		expect(unsigned.statusCode).toBe(401);
	});

	it('verifies a delivery that repeats a form key (every occurrence is signed)', async () => {
		app = buildTwilioApp({
			TWILIO_ACCOUNT_SID: ACCOUNT_SID,
			TWILIO_AUTH_TOKEN: AUTH_TOKEN,
			TWILIO_WHATSAPP_WEBHOOK_URL: PINNED_URL,
		});
		const single = inboundWhatsapp();
		const body = `${new URLSearchParams(single).toString()}&Extra=2&Extra=1`;
		const res = await app.inject({
			method: 'POST',
			url: WHATSAPP_URL,
			payload: body,
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
				// Twilio's SDKs sign a repeated key as its distinct values, sorted.
				'x-twilio-signature': signTwilioRequest({
					authToken: AUTH_TOKEN,
					url: PINNED_URL,
					params: { ...single, Extra: ['2', '1'] },
				}),
			},
		});
		expect(res.statusCode).toBe(200);
		expect(res.body).toBe(EMPTY_TWIML);
	});

	it('derives the signed URL from forwarding headers when none is pinned', async () => {
		app = buildTwilioApp({
			TWILIO_ACCOUNT_SID: ACCOUNT_SID,
			TWILIO_AUTH_TOKEN: AUTH_TOKEN,
		});
		const params = inboundWhatsapp();
		const res = await signedInject(app, {
			url: WHATSAPP_URL,
			signedUrl: PINNED_URL,
			params,
			extraHeaders: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'api.rivus.ai' },
		});
		expect(res.statusCode).toBe(200);
		expect(res.body).toBe(EMPTY_TWIML);
	});

	it('keeps the query string in the signed URL (Twilio signs it verbatim)', async () => {
		app = buildTwilioApp({
			TWILIO_ACCOUNT_SID: ACCOUNT_SID,
			TWILIO_AUTH_TOKEN: AUTH_TOKEN,
		});
		const params = inboundSms();
		const res = await signedInject(app, {
			url: `${SMS_URL}?foo=1&bar=2`,
			signedUrl: `https://api.rivus.ai${SMS_URL}?foo=1&bar=2`,
			params,
			extraHeaders: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'api.rivus.ai' },
		});
		expect(res.statusCode).toBe(200);
		// Signed without the query → rejected; the query is part of the signature.
		const missingQuery = await signedInject(app, {
			url: `${SMS_URL}?foo=1&bar=2`,
			signedUrl: `https://api.rivus.ai${SMS_URL}`,
			params,
			extraHeaders: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'api.rivus.ai' },
		});
		expect(missingQuery.statusCode).toBe(401);
	});

	it('stays open when unconfigured outside production, and 503s in production', async () => {
		app = buildTwilioApp();
		const open = await app.inject({
			method: 'POST',
			url: WHATSAPP_URL,
			payload: inboundWhatsapp(),
		});
		expect(open.statusCode).toBe(200);
		expect(open.body).toBe(EMPTY_TWIML);
		await app.close();

		app = buildTwilioApp({
			NODE_ENV: 'production',
			JWT_SECRET: 'x'.repeat(32),
			RESEND_API_KEY: 're_test_key',
			LOG_LEVEL: 'silent',
			CORS_ORIGIN: 'https://app.rivus.ai',
		});
		const res = await app.inject({
			method: 'POST',
			url: WHATSAPP_URL,
			payload: inboundWhatsapp(),
		});
		expect(res.statusCode).toBe(503);
	});

	it('503s in production on a partial credential pair (token without account sid)', async () => {
		app = buildTwilioApp({
			NODE_ENV: 'production',
			JWT_SECRET: 'x'.repeat(32),
			RESEND_API_KEY: 're_test_key',
			LOG_LEVEL: 'silent',
			CORS_ORIGIN: 'https://app.rivus.ai',
			TWILIO_AUTH_TOKEN: AUTH_TOKEN,
		});
		const params = inboundSms();
		const res = await signedInject(app, {
			url: SMS_URL,
			signedUrl: `https://api.rivus.ai${SMS_URL}`,
			params,
			extraHeaders: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'api.rivus.ai' },
		});
		expect(res.statusCode).toBe(503);
	});
});

// --- Payload mapping edges the route tests don't reach ------------------------

describe('parseTwilioInbound', () => {
	function kind(result: TwilioInboundResult): string {
		return result.kind;
	}

	it('maps an inbound WhatsApp message, stripping the whatsapp: prefix', () => {
		expect(parseTwilioInbound(inboundWhatsapp(), 'whatsapp')).toEqual({
			kind: 'event',
			event: {
				type: 'whatsapp.message.received',
				data: {
					to: BIZ,
					from: SENDER,
					text: 'Hi there',
					messageId: 'SMinbound001',
					profileName: 'Dana',
				},
			},
		});
	});

	it('uses the status as the failure reason when there is no error code', () => {
		expect(
			parseTwilioInbound({ From: BIZ, To: SENDER, MessageStatus: 'undelivered' }, 'sms'),
		).toEqual({
			kind: 'event',
			event: {
				type: 'whatsapp.message.failed',
				data: { from: BIZ, to: SENDER, reason: 'undelivered' },
			},
		});
	});

	it('stringifies a numeric ErrorCode (JSON status callbacks)', () => {
		expect(
			parseTwilioInbound(
				{ From: BIZ, To: SENDER, MessageStatus: 'failed', ErrorCode: 30008 },
				'sms',
			),
		).toEqual({
			kind: 'event',
			event: {
				type: 'whatsapp.message.failed',
				data: { from: BIZ, to: SENDER, reason: '30008' },
			},
		});
	});

	it('ignores in-flight and successful status callbacks (case-insensitive)', () => {
		for (const status of ['queued', 'sending', 'sent', 'delivered', 'read', 'DELIVERED']) {
			expect(
				kind(parseTwilioInbound({ From: BIZ, To: SENDER, MessageStatus: status }, 'sms')),
			).toBe('ignored');
		}
	});

	it('ignores cross-channel status callbacks rather than misrouting them', () => {
		expect(
			kind(parseTwilioInbound({ From: wa(BIZ), To: wa(SENDER), MessageStatus: 'failed' }, 'sms')),
		).toBe('ignored');
		expect(
			kind(parseTwilioInbound({ From: BIZ, To: SENDER, MessageStatus: 'failed' }, 'whatsapp')),
		).toBe('ignored');
	});

	it('rejects non-object and number-less payloads', () => {
		expect(kind(parseTwilioInbound('a string', 'sms'))).toBe('unrecognized');
		expect(kind(parseTwilioInbound(null, 'sms'))).toBe('unrecognized');
		expect(kind(parseTwilioInbound({ From: 'garbage', To: BIZ, Body: 'x' }, 'sms'))).toBe(
			'unrecognized',
		);
		expect(kind(parseTwilioInbound({ From: SENDER, Body: 'x' }, 'sms'))).toBe('unrecognized');
	});
});

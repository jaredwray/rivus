import type { AccountId } from '@rivus/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createInMemoryRepositories } from '../src/repositories/memory';
import { NoopReceivedEmailReader } from '../src/services/agent/email/received';
import { composeAgentResponse } from '../src/services/agent/response';
import { renderVoiceResponse } from '../src/services/agent/voice/renderer';
import { NoopChannelProvisioner, NoopNumberReleaser } from '../src/services/channel-provisioning';
import { createDecider } from '../src/services/chat/decide';
import { NoopFaqAnswerService } from '../src/services/faq-answer';
import { NoopFaqSimilarityService } from '../src/services/faq-similarity';
import { createNotificationService } from '../src/services/notifications';
import { signPlivoUrl } from '../src/services/plivo';
import { NoopWebBrowse } from '../src/services/web-browse';
import { NoopWebSearch } from '../src/services/web-search';
import {
	buildTestAppWithRepos,
	RecordingMailer,
	RecordingSmsSender,
	RecordingWhatsappSender,
	signupOwner,
} from './helpers';

const ANSWER_URL = '/v1/channels/voice/plivo/answer';
const INPUT_URL = '/v1/channels/voice/plivo/input';
// The account's number is stored `+`-formed; Plivo delivers bare digits.
const BIZ = '+15550003333';
const BIZ_PLIVO = '15550003333';
const CALLER = '+15559990000';
const CALLER_PLIVO = '15559990000';

function call(overrides: Record<string, string> = {}) {
	return {
		From: CALLER_PLIVO,
		To: BIZ_PLIVO,
		CallUUID: 'call-0001',
		...overrides,
	};
}

/** Build an app + repos and enable voice on the signed-up owner's account. */
async function setup() {
	const { app, repos } = await buildTestAppWithRepos();
	const owner = await signupOwner(app);
	const accountId = owner.account.id as AccountId;
	await repos.accounts.setChannelConfig(accountId, 'voice', {
		enabled: true,
		address: BIZ,
		providerRef: BIZ_PLIVO,
	});
	return { app, repos, accountId, owner };
}

describe('POST /v1/channels/voice/plivo/answer', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('greets the caller by business name and listens for speech', async () => {
		const built = await setup();
		app = built.app;
		const res = await app.inject({ method: 'POST', url: ANSWER_URL, payload: call() });
		expect(res.statusCode).toBe(200);
		expect(res.headers['content-type']).toContain('xml');
		expect(res.body).toContain('<GetInput');
		expect(res.body).toContain('inputType="speech"');
		expect(res.body).toContain(`action="http://localhost:80${INPUT_URL}"`);
		expect(res.body).toContain('scheduling assistant');
	});

	it('escapes XML-significant characters in the spoken account name', async () => {
		const { app: built, repos, accountId } = await setup();
		app = built;
		const account = await repos.accounts.findById(accountId);
		if (account) {
			await repos.accounts.update(accountId, { name: 'Smith & Sons <Plumbing>' });
		}
		const res = await app.inject({ method: 'POST', url: ANSWER_URL, payload: call() });
		expect(res.body).toContain('Smith &amp; Sons &lt;Plumbing&gt;');
	});

	it('speaks a not-in-service message for a number no account holds', async () => {
		const built = await setup();
		app = built.app;
		const res = await app.inject({
			method: 'POST',
			url: ANSWER_URL,
			payload: call({ To: '15557778888' }),
		});
		expect(res.body).toContain('isn&apos;t in service');
		expect(res.body).not.toContain('<GetInput');
	});

	it('declines restricted/anonymous callers up front instead of greeting them', async () => {
		const built = await setup();
		app = built.app;
		const res = await app.inject({
			method: 'POST',
			url: ANSWER_URL,
			payload: call({ From: '' }),
		});
		expect(res.body).toContain('restricted or anonymous');
		expect(res.body).not.toContain('<GetInput');
	});

	it('speaks an apology instead of JSON when a dependency fails (Plivo needs XML)', async () => {
		const { app: built, repos } = await setup();
		app = built;
		vi.spyOn(repos.accounts, 'findByChannelAddress').mockRejectedValueOnce(new Error('db down'));
		const res = await app.inject({ method: 'POST', url: ANSWER_URL, payload: call() });
		expect(res.statusCode).toBe(200);
		expect(res.headers['content-type']).toContain('xml');
		expect(res.body).toContain('something went wrong');
		expect(res.body).not.toContain('<GetInput');
	});

	it('declines the call when the channel is disabled', async () => {
		const { app: built, repos, accountId } = await setup();
		app = built;
		await repos.accounts.setChannelConfig(accountId, 'voice', {
			enabled: false,
			address: BIZ,
			providerRef: BIZ_PLIVO,
		});
		const res = await app.inject({ method: 'POST', url: ANSWER_URL, payload: call() });
		expect(res.body).toContain('isn&apos;t taking calls');
		expect(res.body).not.toContain('<GetInput');
	});
});

describe('POST /v1/channels/voice/plivo/input', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('offers slots to a recognized caller and keeps listening', async () => {
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
			url: INPUT_URL,
			payload: call({ Speech: 'When are you free?' }),
		});
		expect(res.statusCode).toBe(200);
		expect(res.body).toContain('Option 1:');
		expect(res.body).toContain('Say the number that works for you');
		expect(res.body).toContain('<GetInput');
	});

	it('books when the caller picks a slot, then ends the call', async () => {
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
			url: INPUT_URL,
			payload: call({ Speech: 'When are you free?' }),
		});
		const res = await app.inject({
			method: 'POST',
			url: INPUT_URL,
			// ASR often writes the pick out in words; the route normalizes it.
			payload: call({ Speech: 'option one' }),
		});
		expect(res.body).toContain('You&apos;re booked!');
		expect(res.body).toContain('Goodbye');
		expect(res.body).not.toContain('<GetInput');
		const { total } = await repos.jobs.list({ accountId, page: 1, pageSize: 10 });
		expect(total).toBe(1);
		// The call landed in the inbox as a phone conversation with a transcript.
		const thread = await repos.agentThreads.findByContact(accountId, 'phone', CALLER);
		expect(thread).not.toBeNull();
		const messages = thread
			? await repos.conversations.listMessages(accountId, thread.conversationId)
			: [];
		expect(messages?.some((m) => m.author === 'customer' && m.body === 'option 1')).toBe(true);
	});

	it('sends an unknown caller to signup and ends the call with the spoken link', async () => {
		const built = await setup();
		app = built.app;
		const res = await app.inject({
			method: 'POST',
			url: INPUT_URL,
			payload: call({ Speech: 'Can I book something?' }),
		});
		// Terminal: the URL is read out (no scheme/query) and the call ends.
		expect(res.body).toContain('rivus.ai/customers/join/');
		expect(res.body).not.toContain('https://');
		expect(res.body).not.toContain('<GetInput');
		expect(res.body).toContain('Goodbye');
	});

	it('re-prompts when nothing was transcribed', async () => {
		const built = await setup();
		app = built.app;
		const res = await app.inject({
			method: 'POST',
			url: INPUT_URL,
			payload: call({ Speech: '   ' }),
		});
		expect(res.body).toContain('didn&apos;t catch that');
		expect(res.body).toContain('<GetInput');
	});

	it('speaks an apology when the orchestrator fails mid-turn', async () => {
		const { app: built, repos } = await setup();
		app = built;
		vi.spyOn(repos.agentThreads, 'findByContact').mockRejectedValueOnce(new Error('db down'));
		const res = await app.inject({
			method: 'POST',
			url: INPUT_URL,
			payload: call({ Speech: 'When are you free?' }),
		});
		expect(res.statusCode).toBe(200);
		expect(res.headers['content-type']).toContain('xml');
		expect(res.body).toContain('something went wrong');
	});

	it('hangs up on calls for unknown numbers or from an account’s own number', async () => {
		const { app: built, repos } = await setup();
		app = built;
		const unknown = await app.inject({
			method: 'POST',
			url: INPUT_URL,
			payload: call({ To: '15557778888', Speech: 'hello' }),
		});
		expect(unknown.body).toContain('isn&apos;t in service');

		// A second account whose voice number calls the first (loop guard).
		const other = await signupOwner(app);
		await repos.accounts.setChannelConfig(other.account.id as AccountId, 'voice', {
			enabled: true,
			address: '+15552224444',
			providerRef: '15552224444',
		});
		const loop = await app.inject({
			method: 'POST',
			url: INPUT_URL,
			payload: call({ From: '15552224444', Speech: 'hello' }),
		});
		expect(loop.body).toContain('Goodbye');
		expect(loop.body).not.toContain('<GetInput');
	});
});

// --- Signature (separate config) ---------------------------------------------

const AUTH_TOKEN = 'plivo-test-auth-token';

function buildVoiceApp(extraConfig: Record<string, string> = {}): FastifyInstance {
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
		webSearch: new NoopWebSearch(),
		webBrowse: new NoopWebBrowse(),
		ping: async () => ({ ready: true }),
	});
}

describe('POST /v1/channels/voice/plivo/* — signature', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('verifies against each endpoint’s own reconstructed URL', async () => {
		app = buildVoiceApp({ PLIVO_AUTH_TOKEN: AUTH_TOKEN });
		const nonce = '77665544';
		const signed = await app.inject({
			method: 'POST',
			url: ANSWER_URL,
			payload: call(),
			headers: {
				'x-plivo-signature-v2-nonce': nonce,
				'x-plivo-signature-v2': signPlivoUrl({
					authToken: AUTH_TOKEN,
					url: `http://localhost:80${ANSWER_URL}`,
					nonce,
				}),
			},
		});
		// Unknown account, but spoken politely — the signature passed.
		expect(signed.statusCode).toBe(200);
		expect(signed.body).toContain('isn&apos;t in service');

		const unsigned = await app.inject({ method: 'POST', url: ANSWER_URL, payload: call() });
		expect(unsigned.statusCode).toBe(401);

		// A signature minted for the answer URL never opens the input URL.
		const crossPath = await app.inject({
			method: 'POST',
			url: INPUT_URL,
			payload: call({ Speech: 'hi' }),
			headers: {
				'x-plivo-signature-v2-nonce': nonce,
				'x-plivo-signature-v2': signPlivoUrl({
					authToken: AUTH_TOKEN,
					url: `http://localhost:80${ANSWER_URL}`,
					nonce,
				}),
			},
		});
		expect(crossPath.statusCode).toBe(401);
	});

	it('stays open when unconfigured outside production, and 503s in production', async () => {
		app = buildVoiceApp();
		const open = await app.inject({ method: 'POST', url: ANSWER_URL, payload: call() });
		expect(open.statusCode).toBe(200);
		await app.close();

		app = buildVoiceApp({
			NODE_ENV: 'production',
			JWT_SECRET: 'x'.repeat(32),
			RESEND_API_KEY: 're_test_key',
			LOG_LEVEL: 'silent',
			CORS_ORIGIN: 'https://app.rivus.ai',
		});
		const res = await app.inject({ method: 'POST', url: ANSWER_URL, payload: call() });
		expect(res.statusCode).toBe(503);
	});
});

// --- Spoken rendering ----------------------------------------------------------

describe('renderVoiceResponse', () => {
	const context = {
		accountName: 'Cascade Plumbing',
		customerName: 'Dana Fox',
		timeZone: 'America/Los_Angeles',
		signupUrl: 'https://www.rivus.ai/customers/join/cascade?phone=%2B15559990000',
		jobTitle: 'Water heater',
		now: new Date('2026-07-03T17:00:00.000Z'),
		medium: 'voice' as const,
	};

	it('speaks options as "Option N", not a numbered list', () => {
		const speech = renderVoiceResponse(
			composeAgentResponse(
				{
					kind: 'offer_slots',
					slots: [
						{ startAt: '2026-07-07T16:00:00.000Z', durationMinutes: 60 },
						{ startAt: '2026-07-09T21:00:00.000Z', durationMinutes: 60 },
					],
				},
				context,
			),
		);
		expect(speech).toContain('Option 1:');
		expect(speech).toContain('Option 2:');
		expect(speech).not.toContain('\n');
		expect(speech).toContain('Say the number that works for you');
	});

	it('reads links without scheme or query, and flows multi-line text', () => {
		const speech = renderVoiceResponse(
			composeAgentResponse({ kind: 'send_signup_link' }, { ...context, customerName: '' }),
		);
		expect(speech).toContain('www.rivus.ai/customers/join/cascade');
		expect(speech).not.toContain('https://');
		expect(speech).not.toContain('?phone=');
		expect(speech).not.toContain('\n');
		expect(speech).toContain('phone number');
	});
});

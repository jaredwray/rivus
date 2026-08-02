import type { AccountId } from '@rivus/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createInMemoryRepositories } from '../src/repositories/memory';
import { runVoiceTurn, VOICE_LINES } from '../src/routes/agent-voice-shared';
import { NoopReceivedEmailReader } from '../src/services/agent/email/received';
import { NoopChannelProvisioner, NoopNumberReleaser } from '../src/services/channel-provisioning';
import { createDecider } from '../src/services/chat/decide';
import { NoopFaqAnswerService } from '../src/services/faq-answer';
import { NoopFaqSimilarityService } from '../src/services/faq-similarity';
import { createNotificationService } from '../src/services/notifications';
import { signTwilioRequest } from '../src/services/twilio';
import { createWebsiteAuditService } from '../src/services/website-audit';
import {
	buildTestAppWithRepos,
	RecordingMailer,
	RecordingSmsSender,
	RecordingWhatsappSender,
	signupOwner,
} from './helpers';

const ANSWER_URL = '/v1/channels/voice/twilio/answer';
const INPUT_URL = '/v1/channels/voice/twilio/input';
// Twilio delivers numbers already in E.164.
const BIZ = '+15550003333';
const CALLER = '+15559990000';
const NUMBER_SID = 'PN0123456789abcdef0123456789abcdef';

function call(overrides: Record<string, string> = {}) {
	return {
		From: CALLER,
		To: BIZ,
		CallSid: 'CAcall0001',
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
		providerRef: NUMBER_SID,
	});
	return { app, repos, accountId, owner };
}

describe('POST /v1/channels/voice/twilio/answer', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('greets the caller by business name and gathers speech', async () => {
		const built = await setup();
		app = built.app;
		const res = await app.inject({ method: 'POST', url: ANSWER_URL, payload: call() });
		expect(res.statusCode).toBe(200);
		expect(res.headers['content-type']).toContain('xml');
		expect(res.body).toContain('<Gather');
		expect(res.body).toContain('input="speech"');
		expect(res.body).toContain('speechTimeout="auto"');
		expect(res.body).toContain(`action="http://localhost:80${INPUT_URL}"`);
		expect(res.body).toContain('scheduling assistant');
	});

	it('escapes XML-significant characters in the spoken account name', async () => {
		const { app: built, repos, accountId } = await setup();
		app = built;
		await repos.accounts.update(accountId, { name: 'Smith & Sons <Plumbing>' });
		const res = await app.inject({ method: 'POST', url: ANSWER_URL, payload: call() });
		expect(res.body).toContain('Smith &amp; Sons &lt;Plumbing&gt;');
	});

	it('speaks a not-in-service message for a number no account holds', async () => {
		const built = await setup();
		app = built.app;
		const res = await app.inject({
			method: 'POST',
			url: ANSWER_URL,
			payload: call({ To: '+15557778888' }),
		});
		expect(res.body).toContain('isn&apos;t in service');
		expect(res.body).not.toContain('<Gather');
	});

	it('speaks not-in-service when the called number is missing entirely', async () => {
		const built = await setup();
		app = built.app;
		const res = await app.inject({
			method: 'POST',
			url: ANSWER_URL,
			payload: { From: CALLER, CallSid: 'CAcall0002' },
		});
		expect(res.body).toContain('isn&apos;t in service');
		expect(res.body).not.toContain('<Gather');
	});

	it('declines restricted/anonymous callers up front instead of greeting them', async () => {
		const built = await setup();
		app = built.app;
		// Twilio marks withheld caller IDs with non-numeric From values.
		for (const from of ['', 'anonymous', 'restricted']) {
			const res = await app.inject({
				method: 'POST',
				url: ANSWER_URL,
				payload: call({ From: from }),
			});
			expect(res.body).toContain('restricted or anonymous');
			expect(res.body).not.toContain('<Gather');
		}
	});

	it('speaks an apology instead of JSON when a dependency fails (Twilio needs TwiML)', async () => {
		const { app: built, repos } = await setup();
		app = built;
		vi.spyOn(repos.accounts, 'findByChannelAddress').mockRejectedValueOnce(new Error('db down'));
		const res = await app.inject({ method: 'POST', url: ANSWER_URL, payload: call() });
		expect(res.statusCode).toBe(200);
		expect(res.headers['content-type']).toContain('xml');
		expect(res.body).toContain('something went wrong');
		expect(res.body).not.toContain('<Gather');
	});

	it('declines the call when the channel is disabled', async () => {
		const { app: built, repos, accountId } = await setup();
		app = built;
		await repos.accounts.setChannelConfig(accountId, 'voice', {
			enabled: false,
			address: BIZ,
			providerRef: NUMBER_SID,
		});
		const res = await app.inject({ method: 'POST', url: ANSWER_URL, payload: call() });
		expect(res.body).toContain('isn&apos;t taking calls');
		expect(res.body).not.toContain('<Gather');
	});
});

describe('POST /v1/channels/voice/twilio/input', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('offers slots to a recognized caller and keeps gathering', async () => {
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
			payload: call({ SpeechResult: 'When are you free?' }),
		});
		expect(res.statusCode).toBe(200);
		expect(res.body).toContain('Option 1:');
		expect(res.body).toContain('Say the number that works for you');
		expect(res.body).toContain('<Gather');
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
			payload: call({ SpeechResult: 'When are you free?' }),
		});
		const res = await app.inject({
			method: 'POST',
			url: INPUT_URL,
			// ASR often writes the pick out in words; the shared core normalizes it.
			payload: call({ SpeechResult: 'option one' }),
		});
		expect(res.body).toContain('You&apos;re booked!');
		expect(res.body).toContain('Goodbye');
		expect(res.body).not.toContain('<Gather');
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
			payload: call({ SpeechResult: 'Can I book something?' }),
		});
		expect(res.body).toContain('rivus.ai/customers/join/');
		expect(res.body).not.toContain('https://');
		expect(res.body).not.toContain('<Gather');
		expect(res.body).toContain('Goodbye');
	});

	it('re-prompts when nothing was transcribed', async () => {
		const built = await setup();
		app = built.app;
		const res = await app.inject({
			method: 'POST',
			url: INPUT_URL,
			payload: call({ SpeechResult: '   ' }),
		});
		expect(res.body).toContain('didn&apos;t catch that');
		expect(res.body).toContain('<Gather');
	});

	it('declines restricted/anonymous callers mid-call too', async () => {
		const built = await setup();
		app = built.app;
		const res = await app.inject({
			method: 'POST',
			url: INPUT_URL,
			payload: call({ From: 'anonymous', SpeechResult: 'hello' }),
		});
		expect(res.body).toContain('restricted or anonymous');
		expect(res.body).not.toContain('<Gather');
	});

	it('speaks an apology when the orchestrator fails mid-turn', async () => {
		const { app: built, repos } = await setup();
		app = built;
		vi.spyOn(repos.agentThreads, 'findByContact').mockRejectedValueOnce(new Error('db down'));
		const res = await app.inject({
			method: 'POST',
			url: INPUT_URL,
			payload: call({ SpeechResult: 'When are you free?' }),
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
			payload: call({ To: '+15557778888', SpeechResult: 'hello' }),
		});
		expect(unknown.body).toContain('isn&apos;t in service');

		// A second account whose voice number calls the first (loop guard).
		const other = await signupOwner(app);
		await repos.accounts.setChannelConfig(other.account.id as AccountId, 'voice', {
			enabled: true,
			address: '+15552224444',
			providerRef: 'PNfeedfacefeedfacefeedfacefeedface',
		});
		const loop = await app.inject({
			method: 'POST',
			url: INPUT_URL,
			payload: call({ From: '+15552224444', SpeechResult: 'hello' }),
		});
		expect(loop.body).toContain('Goodbye');
		expect(loop.body).not.toContain('<Gather');
	});
});

// --- Signature and pinned URLs (separate config) -------------------------------

const ACCOUNT_SID = 'ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const AUTH_TOKEN = 'twilio-test-auth-token';
const PINNED_ANSWER_URL = 'https://api.rivus.ai/v1/channels/voice/twilio/answer';
const PINNED_INPUT_URL = 'https://api.rivus.ai/v1/channels/voice/twilio/input';

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
		websiteAudit: createWebsiteAuditService({}),
		ping: async () => ({ ready: true }),
	});
}

/** POST `params` form-encoded with an X-Twilio-Signature minted for `signedUrl`. */
function signedInject(
	app: FastifyInstance,
	options: { url: string; signedUrl: string; params: Record<string, string> },
) {
	return app.inject({
		method: 'POST',
		url: options.url,
		payload: new URLSearchParams(options.params).toString(),
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			'x-twilio-signature': signTwilioRequest({
				authToken: AUTH_TOKEN,
				url: options.signedUrl,
				params: options.params,
			}),
		},
	});
}

describe('POST /v1/channels/voice/twilio/* — signature', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('verifies against each endpoint’s own reconstructed URL when nothing is pinned', async () => {
		app = buildVoiceApp({ TWILIO_ACCOUNT_SID: ACCOUNT_SID, TWILIO_AUTH_TOKEN: AUTH_TOKEN });
		const signed = await signedInject(app, {
			url: ANSWER_URL,
			signedUrl: `http://localhost:80${ANSWER_URL}`,
			params: call(),
		});
		// Unknown account, but spoken politely — the signature passed.
		expect(signed.statusCode).toBe(200);
		expect(signed.body).toContain('isn&apos;t in service');

		const unsigned = await app.inject({ method: 'POST', url: ANSWER_URL, payload: call() });
		expect(unsigned.statusCode).toBe(401);

		// A signature minted for the answer URL never opens the input URL.
		const crossPath = await signedInject(app, {
			url: INPUT_URL,
			signedUrl: `http://localhost:80${ANSWER_URL}`,
			params: call({ SpeechResult: 'hi' }),
		});
		expect(crossPath.statusCode).toBe(401);

		// The form parameters are part of the signature.
		const params = call();
		const tampered = await app.inject({
			method: 'POST',
			url: ANSWER_URL,
			payload: new URLSearchParams({ ...params, From: '+15550009999' }).toString(),
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
				'x-twilio-signature': signTwilioRequest({
					authToken: AUTH_TOKEN,
					url: `http://localhost:80${ANSWER_URL}`,
					params,
				}),
			},
		});
		expect(tampered.statusCode).toBe(401);
	});

	it('pins the answer URL and derives the input and action URLs from it', async () => {
		app = buildVoiceApp({
			TWILIO_ACCOUNT_SID: ACCOUNT_SID,
			TWILIO_AUTH_TOKEN: AUTH_TOKEN,
			TWILIO_VOICE_WEBHOOK_URL: PINNED_ANSWER_URL,
		});
		// The answer endpoint verifies against the pinned URL (no forwarding
		// headers needed) and hands Gather the pinned origin's input URL.
		const answer = await signedInject(app, {
			url: ANSWER_URL,
			signedUrl: PINNED_ANSWER_URL,
			params: call(),
		});
		expect(answer.statusCode).toBe(200);

		// The input endpoint verifies against the derived input URL — exactly the
		// action URL the answer TwiML hands out.
		const input = await signedInject(app, {
			url: INPUT_URL,
			signedUrl: PINNED_INPUT_URL,
			params: call({ SpeechResult: 'hi' }),
		});
		expect(input.statusCode).toBe(200);

		// With a pin, a request-derived signature no longer verifies.
		const requestDerived = await signedInject(app, {
			url: ANSWER_URL,
			signedUrl: `http://localhost:80${ANSWER_URL}`,
			params: call(),
		});
		expect(requestDerived.statusCode).toBe(401);
	});

	it('speaks the pinned origin in the Gather action URL', async () => {
		// Signature checking off (no token) to reach the handler easily; the pin
		// still steers the action URL.
		const repos = createInMemoryRepositories();
		const built = buildApp({
			config: loadConfig({
				NODE_ENV: 'test',
				JWT_SECRET: 'test-secret-value-1234',
				TWILIO_VOICE_WEBHOOK_URL: PINNED_ANSWER_URL,
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
		app = built;
		const owner = await signupOwner(app);
		await repos.accounts.setChannelConfig(owner.account.id as AccountId, 'voice', {
			enabled: true,
			address: BIZ,
			providerRef: NUMBER_SID,
		});
		const res = await app.inject({ method: 'POST', url: ANSWER_URL, payload: call() });
		expect(res.body).toContain(`action="${PINNED_INPUT_URL}"`);
		expect(res.body).not.toContain('localhost');
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

// --- The shared voice core's fallback edge ------------------------------------

describe('runVoiceTurn', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('ends the call politely when the turn produces nothing to speak', async () => {
		const { app: built, repos } = await buildTestAppWithRepos();
		app = built;
		const owner = await signupOwner(app);
		const account = await repos.accounts.findById(owner.account.id as AccountId);
		if (!account) {
			throw new Error('account missing');
		}
		const turn = await runVoiceTurn({
			deps: {
				config: app.deps.config,
				jobs: repos.jobs,
				conversations: repos.conversations,
				agentThreads: repos.agentThreads,
				faqs: repos.faqs,
				faqAnswer: app.deps.faqAnswer,
				memberships: repos.memberships,
				notifier: app.deps.notifier,
			},
			customers: repos.customers,
			// A capability whose reply renders to empty speech — there is nothing
			// to say, so the call must close politely instead of looping silence.
			capabilities: [
				{
					id: 'mute',
					matches: () => true,
					handle: async () => ({
						response: { blocks: [] },
						outcome: 'mute',
						threadPatch: {},
					}),
				},
			],
			account,
			caller: CALLER,
			speech: 'hello there',
			logger: app.log,
		});
		expect(turn).toEqual({ mode: 'terminal', text: VOICE_LINES.goodbye });
	});
});

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import {
	TWILIO_SANDBOX_PROVIDER_REF,
	TWILIO_WHATSAPP_SANDBOX_NUMBER,
} from '../src/services/twilio';
import {
	authHeader,
	buildTestApp,
	buildTestAppWithRepos,
	type RecordingWhatsappSender,
	signupOwner,
} from './helpers';

const SANDBOX_URL = '/v1/admin/sandbox/whatsapp';
const STAFF_EMAIL = 'ops@rivus.ai';

/** Dev-mode config (NODE_ENV=development), where the sandbox route is registered. */
function devConfig() {
	return loadConfig({
		NODE_ENV: 'development',
		JWT_SECRET: 'test-secret-value-1234',
		LOG_LEVEL: 'silent',
	} as NodeJS.ProcessEnv);
}

/**
 * The dev-only switch that points an account's WhatsApp channel at Twilio's
 * shared sandbox number, so sandbox conversations resolve to the account and
 * the agent answers — the zero-compliance way to test WhatsApp end-to-end.
 */
describe('POST /v1/admin/sandbox/whatsapp', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('does not exist outside development (404, like the seeder)', async () => {
		// The default test app runs with NODE_ENV=test, so the route is never registered.
		app = await buildTestApp();
		const staff = await signupOwner(app, { email: STAFF_EMAIL });
		const res = await app.inject({
			method: 'POST',
			url: SANDBOX_URL,
			headers: authHeader(staff.token),
			payload: {},
		});
		expect(res.statusCode).toBe(404);
	});

	it('rejects non-staff users with 403', async () => {
		app = await buildTestApp({ config: devConfig() });
		const owner = await signupOwner(app, { email: 'owner@acme.test' });
		const res = await app.inject({
			method: 'POST',
			url: SANDBOX_URL,
			headers: authHeader(owner.token),
			payload: {},
		});
		expect(res.statusCode).toBe(403);
	});

	it('attaches the sandbox number to the current account (attach is the default mode)', async () => {
		const { app: built, repos } = await buildTestAppWithRepos({ config: devConfig() });
		app = built;
		const staff = await signupOwner(app, { email: STAFF_EMAIL });
		const res = await app.inject({
			method: 'POST',
			url: SANDBOX_URL,
			headers: authHeader(staff.token),
			payload: {},
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().channels.whatsapp).toMatchObject({
			enabled: true,
			address: TWILIO_WHATSAPP_SANDBOX_NUMBER,
		});
		// The stored ref is the sandbox marker — not an ownership fingerprint, so
		// sharing/routing never treat the shared number as an owned one.
		const account = await repos.accounts.findById(staff.account.id);
		expect(account?.channels.whatsapp.providerRef).toBe(TWILIO_SANDBOX_PROVIDER_REF);
	});

	it('is idempotent: re-attaching while on the sandbox stays attached', async () => {
		app = await buildTestApp({ config: devConfig() });
		const staff = await signupOwner(app, { email: STAFF_EMAIL });
		await app.inject({
			method: 'POST',
			url: SANDBOX_URL,
			headers: authHeader(staff.token),
			payload: { mode: 'attach' },
		});
		const again = await app.inject({
			method: 'POST',
			url: SANDBOX_URL,
			headers: authHeader(staff.token),
			payload: { mode: 'attach' },
		});
		expect(again.statusCode).toBe(200);
		expect(again.json().channels.whatsapp.address).toBe(TWILIO_WHATSAPP_SANDBOX_NUMBER);
	});

	it('refuses to replace a real provisioned number (409)', async () => {
		const { app: built, repos } = await buildTestAppWithRepos({ config: devConfig() });
		app = built;
		const staff = await signupOwner(app, { email: STAFF_EMAIL });
		await repos.accounts.setChannelConfig(staff.account.id, 'whatsapp', {
			enabled: true,
			address: '+14155550100',
			providerRef: 'PN0123456789abcdef0123456789abcdef',
		});
		const res = await app.inject({
			method: 'POST',
			url: SANDBOX_URL,
			headers: authHeader(staff.token),
			payload: { mode: 'attach' },
		});
		expect(res.statusCode).toBe(409);
		// The real number is untouched.
		const account = await repos.accounts.findById(staff.account.id);
		expect(account?.channels.whatsapp.address).toBe('+14155550100');
	});

	it('detaches only when actually on the sandbox, resetting the channel to empty', async () => {
		const { app: built, repos } = await buildTestAppWithRepos({ config: devConfig() });
		app = built;
		const staff = await signupOwner(app, { email: STAFF_EMAIL });

		// Not attached yet → detach is a 409, not a silent wipe.
		const early = await app.inject({
			method: 'POST',
			url: SANDBOX_URL,
			headers: authHeader(staff.token),
			payload: { mode: 'detach' },
		});
		expect(early.statusCode).toBe(409);

		await app.inject({
			method: 'POST',
			url: SANDBOX_URL,
			headers: authHeader(staff.token),
			payload: { mode: 'attach' },
		});
		const res = await app.inject({
			method: 'POST',
			url: SANDBOX_URL,
			headers: authHeader(staff.token),
			payload: { mode: 'detach' },
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().channels.whatsapp).toMatchObject({ enabled: false, address: '' });
		const account = await repos.accounts.findById(staff.account.id);
		expect(account?.channels.whatsapp.providerRef).toBe('');
	});

	it('never clears a real number on detach (409)', async () => {
		const { app: built, repos } = await buildTestAppWithRepos({ config: devConfig() });
		app = built;
		const staff = await signupOwner(app, { email: STAFF_EMAIL });
		await repos.accounts.setChannelConfig(staff.account.id, 'whatsapp', {
			enabled: true,
			address: '+14155550100',
			providerRef: 'PN0123456789abcdef0123456789abcdef',
		});
		const res = await app.inject({
			method: 'POST',
			url: SANDBOX_URL,
			headers: authHeader(staff.token),
			payload: { mode: 'detach' },
		});
		expect(res.statusCode).toBe(409);
		const account = await repos.accounts.findById(staff.account.id);
		expect(account?.channels.whatsapp.address).toBe('+14155550100');
	});

	it('allows one sandbox tenant per deployment (second account attach → 409)', async () => {
		app = await buildTestApp({ config: devConfig() });
		const first = await signupOwner(app, { email: STAFF_EMAIL });
		await app.inject({
			method: 'POST',
			url: SANDBOX_URL,
			headers: authHeader(first.token),
			payload: {},
		});
		const second = await signupOwner(app, { email: 'ops2@rivus.ai' });
		const res = await app.inject({
			method: 'POST',
			url: SANDBOX_URL,
			headers: authHeader(second.token),
			payload: {},
		});
		expect(res.statusCode).toBe(409);
	});

	it('routes inbound sandbox WhatsApp messages to the attached account end-to-end', async () => {
		app = await buildTestApp({ config: devConfig() });
		const staff = await signupOwner(app, { email: STAFF_EMAIL });
		await app.inject({
			method: 'POST',
			url: SANDBOX_URL,
			headers: authHeader(staff.token),
			payload: {},
		});
		// A sandbox tester texts the shared number; Twilio posts it to our hook.
		const inbound = await app.inject({
			method: 'POST',
			url: '/v1/channels/whatsapp/twilio/inbound',
			payload: {
				From: 'whatsapp:+15559990000',
				To: `whatsapp:${TWILIO_WHATSAPP_SANDBOX_NUMBER}`,
				Body: 'Can I book something?',
				MessageSid: 'SMsandbox001',
				ProfileName: 'Dana',
			},
		});
		expect(inbound.statusCode).toBe(200);
		expect(inbound.body).toBe('<Response/>');
		// The agent replied from the sandbox number (unknown sender → signup link).
		const sender = app.deps.whatsappSender as RecordingWhatsappSender;
		const sent = sender.messages.at(-1);
		expect(sent?.from).toBe(TWILIO_WHATSAPP_SANDBOX_NUMBER);
		expect(sent?.to).toBe('+15559990000');
		expect(sent?.text).toContain('phone=');
		expect(sent?.providerRef).toBe(TWILIO_SANDBOX_PROVIDER_REF);
	});
});

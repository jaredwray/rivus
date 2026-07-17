import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import type { NumberReleaser, ReleaseOutcome } from '../src/services/channel-provisioning';
import {
	TWILIO_SANDBOX_PROVIDER_REF,
	TWILIO_WHATSAPP_SANDBOX_NUMBER,
} from '../src/services/twilio';
import { authHeader, buildTestApp, buildTestAppWithRepos, signupOwner } from './helpers';

const RELEASE_URL = '/v1/admin/release-number';
const STAFF_EMAIL = 'ops@rivus.ai';
const NUMBER_SID = 'PN0123456789abcdef0123456789abcdef';
const OTHER_SID = 'PNfedcba9876543210fedcba9876543210';

/** Dev-mode config (NODE_ENV=development), where the release route is registered. */
function devConfig() {
	return loadConfig({
		NODE_ENV: 'development',
		JWT_SECRET: 'test-secret-value-1234',
		LOG_LEVEL: 'silent',
	} as NodeJS.ProcessEnv);
}

/** Records every release and replays a scripted outcome (default: released). */
class RecordingNumberReleaser implements NumberReleaser {
	readonly releases: string[] = [];
	constructor(private readonly outcomes: Record<string, ReleaseOutcome | Error> = {}) {}

	async release(providerRef: string): Promise<ReleaseOutcome> {
		this.releases.push(providerRef);
		const outcome = this.outcomes[providerRef] ?? 'released';
		if (outcome instanceof Error) {
			throw outcome;
		}
		return outcome;
	}
}

/**
 * The dev-only "release & reset" flow: hand every Twilio-rented number back and
 * wipe the phone channels, so a broken dev number (dead carrier routing, missed
 * webhooks) can be swapped for a fresh rental with one click.
 */
describe('POST /v1/admin/release-number', () => {
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
			url: RELEASE_URL,
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
			url: RELEASE_URL,
			headers: authHeader(owner.token),
			payload: {},
		});
		expect(res.statusCode).toBe(403);
	});

	it('releases a number shared across channels exactly once and resets all three channels', async () => {
		const releaser = new RecordingNumberReleaser();
		const { app: built, repos } = await buildTestAppWithRepos({
			config: devConfig(),
			numberReleaser: releaser,
		});
		app = built;
		const staff = await signupOwner(app, { email: STAFF_EMAIL });
		// One Twilio rental shared by SMS and voice (the sharing feature), plus a
		// second rental on WhatsApp.
		await repos.accounts.setChannelConfig(staff.account.id, 'sms', {
			enabled: true,
			address: '+14155550100',
			providerRef: NUMBER_SID,
		});
		await repos.accounts.setChannelConfig(staff.account.id, 'voice', {
			enabled: true,
			address: '+14155550100',
			providerRef: NUMBER_SID,
		});
		await repos.accounts.setChannelConfig(staff.account.id, 'whatsapp', {
			enabled: true,
			address: '+14155550199',
			providerRef: OTHER_SID,
		});

		const res = await app.inject({
			method: 'POST',
			url: RELEASE_URL,
			headers: authHeader(staff.token),
			payload: {},
		});
		expect(res.statusCode).toBe(200);
		// The shared rental is released once, not once per channel.
		expect(releaser.releases.sort()).toEqual([NUMBER_SID, OTHER_SID].sort());
		expect(res.json().released.sort()).toEqual(['+14155550100', '+14155550199'].sort());
		expect(res.json().forgotten).toEqual([]);
		for (const channel of ['whatsapp', 'sms', 'voice'] as const) {
			expect(res.json().account.channels[channel]).toMatchObject({ enabled: false, address: '' });
		}
		const account = await repos.accounts.findById(staff.account.id);
		expect(account?.channels.sms.providerRef).toBe('');
		expect(account?.channels.voice.providerRef).toBe('');
		expect(account?.channels.whatsapp.providerRef).toBe('');
	});

	it('refuses (409) a number Twilio does not know — it may be another account’s rental', async () => {
		// The DELETE is account-scoped: a 404 can mean "released in the console",
		// but equally "rented under a different TWILIO_ACCOUNT_SID and still
		// billing there" — so forgetting it must be an explicit choice.
		const releaser = new RecordingNumberReleaser({ [NUMBER_SID]: 'not_found' });
		const { app: built, repos } = await buildTestAppWithRepos({
			config: devConfig(),
			numberReleaser: releaser,
		});
		app = built;
		const staff = await signupOwner(app, { email: STAFF_EMAIL });
		await repos.accounts.setChannelConfig(staff.account.id, 'sms', {
			enabled: true,
			address: '+14155550100',
			providerRef: NUMBER_SID,
		});
		const res = await app.inject({
			method: 'POST',
			url: RELEASE_URL,
			headers: authHeader(staff.token),
			payload: {},
		});
		expect(res.statusCode).toBe(409);
		expect(res.json().message).toContain("doesn't know +14155550100");
		const account = await repos.accounts.findById(staff.account.id);
		expect(account?.channels.sms).toMatchObject({
			enabled: true,
			address: '+14155550100',
			providerRef: NUMBER_SID,
		});
	});

	it('forgets an unknown number only when clearUnknown is sent, reporting it separately', async () => {
		const releaser = new RecordingNumberReleaser({ [NUMBER_SID]: 'not_found' });
		const { app: built, repos } = await buildTestAppWithRepos({
			config: devConfig(),
			numberReleaser: releaser,
		});
		app = built;
		const staff = await signupOwner(app, { email: STAFF_EMAIL });
		await repos.accounts.setChannelConfig(staff.account.id, 'sms', {
			enabled: true,
			address: '+14155550100',
			providerRef: NUMBER_SID,
		});
		const res = await app.inject({
			method: 'POST',
			url: RELEASE_URL,
			headers: authHeader(staff.token),
			payload: { clearUnknown: true },
		});
		expect(res.statusCode).toBe(200);
		// Not claimed as released — Twilio never confirmed anything.
		expect(res.json().released).toEqual([]);
		expect(res.json().forgotten).toEqual(['+14155550100']);
		const account = await repos.accounts.findById(staff.account.id);
		expect(account?.channels.sms).toMatchObject({ enabled: false, address: '', providerRef: '' });
	});

	it('splits confirmed releases from forgotten numbers in a mixed batch', async () => {
		const releaser = new RecordingNumberReleaser({ [NUMBER_SID]: 'not_found' });
		const { app: built, repos } = await buildTestAppWithRepos({
			config: devConfig(),
			numberReleaser: releaser,
		});
		app = built;
		const staff = await signupOwner(app, { email: STAFF_EMAIL });
		await repos.accounts.setChannelConfig(staff.account.id, 'whatsapp', {
			enabled: true,
			address: '+14155550199',
			providerRef: OTHER_SID,
		});
		await repos.accounts.setChannelConfig(staff.account.id, 'sms', {
			enabled: true,
			address: '+14155550100',
			providerRef: NUMBER_SID,
		});
		const res = await app.inject({
			method: 'POST',
			url: RELEASE_URL,
			headers: authHeader(staff.token),
			payload: { clearUnknown: true },
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().released).toEqual(['+14155550199']);
		expect(res.json().forgotten).toEqual(['+14155550100']);
		const account = await repos.accounts.findById(staff.account.id);
		expect(account?.channels.whatsapp).toMatchObject({ enabled: false, address: '' });
		expect(account?.channels.sms).toMatchObject({ enabled: false, address: '' });
	});

	it('answers 502 and clears nothing when the provider refuses the only release', async () => {
		const releaser = new RecordingNumberReleaser({
			[NUMBER_SID]: new Error('Twilio refused to release (status 401)'),
		});
		const { app: built, repos } = await buildTestAppWithRepos({
			config: devConfig(),
			numberReleaser: releaser,
		});
		app = built;
		const staff = await signupOwner(app, { email: STAFF_EMAIL });
		await repos.accounts.setChannelConfig(staff.account.id, 'sms', {
			enabled: true,
			address: '+14155550100',
			providerRef: NUMBER_SID,
		});
		const res = await app.inject({
			method: 'POST',
			url: RELEASE_URL,
			headers: authHeader(staff.token),
			payload: {},
		});
		expect(res.statusCode).toBe(502);
		expect(res.json().message).toContain('Nothing was reset');
		// The number may still be rented (and billing), so the account keeps it.
		const account = await repos.accounts.findById(staff.account.id);
		expect(account?.channels.sms).toMatchObject({
			enabled: true,
			address: '+14155550100',
			providerRef: NUMBER_SID,
		});
	});

	it('on a mid-batch refusal, keeps already-released numbers reset and the failing one visible', async () => {
		// WhatsApp's rental releases fine; the SMS rental is refused.
		const releaser = new RecordingNumberReleaser({
			[NUMBER_SID]: new Error('Twilio refused to release (status 401)'),
		});
		const { app: built, repos } = await buildTestAppWithRepos({
			config: devConfig(),
			numberReleaser: releaser,
		});
		app = built;
		const staff = await signupOwner(app, { email: STAFF_EMAIL });
		await repos.accounts.setChannelConfig(staff.account.id, 'whatsapp', {
			enabled: true,
			address: '+14155550199',
			providerRef: OTHER_SID,
		});
		await repos.accounts.setChannelConfig(staff.account.id, 'sms', {
			enabled: true,
			address: '+14155550100',
			providerRef: NUMBER_SID,
		});
		const res = await app.inject({
			method: 'POST',
			url: RELEASE_URL,
			headers: authHeader(staff.token),
			payload: {},
		});
		expect(res.statusCode).toBe(502);
		// The message owns up to the partial progress instead of claiming a no-op.
		expect(res.json().message).toContain('+14155550100');
		expect(res.json().message).toContain('+14155550199');
		const account = await repos.accounts.findById(staff.account.id);
		// The released rental's channel is reset (its number is dead at Twilio)…
		expect(account?.channels.whatsapp).toMatchObject({ enabled: false, address: '' });
		// …while the refused rental stays visible: it may still be billing.
		expect(account?.channels.sms).toMatchObject({
			enabled: true,
			address: '+14155550100',
			providerRef: NUMBER_SID,
		});
	});

	it('refuses (409) to touch anything when a channel holds another provider’s rental', async () => {
		const releaser = new RecordingNumberReleaser();
		const { app: built, repos } = await buildTestAppWithRepos({
			config: devConfig(),
			numberReleaser: releaser,
		});
		app = built;
		const staff = await signupOwner(app, { email: STAFF_EMAIL });
		await repos.accounts.setChannelConfig(staff.account.id, 'whatsapp', {
			enabled: true,
			address: '+14155550199',
			providerRef: NUMBER_SID,
		});
		// A Plivo-owned number stores the address's bare digits as its ref — this
		// deployment can't release it, so wiping it would orphan a billing rental.
		await repos.accounts.setChannelConfig(staff.account.id, 'sms', {
			enabled: true,
			address: '+14155550100',
			providerRef: '14155550100',
		});
		const res = await app.inject({
			method: 'POST',
			url: RELEASE_URL,
			headers: authHeader(staff.token),
			payload: {},
		});
		expect(res.statusCode).toBe(409);
		expect(res.json().message).toContain('+14155550100');
		// Atomic refusal: even the releasable Twilio rental was left alone.
		expect(releaser.releases).toEqual([]);
		const account = await repos.accounts.findById(staff.account.id);
		expect(account?.channels.whatsapp.providerRef).toBe(NUMBER_SID);
		expect(account?.channels.sms.providerRef).toBe('14155550100');
	});

	it('refuses (409) to wipe a rental when there are no credentials to release it with', async () => {
		// No numberReleaser override: the helpers wire the no-op releaser, exactly
		// what createTwilioNumberReleaser produces when credentials are absent.
		const { app: built, repos } = await buildTestAppWithRepos({ config: devConfig() });
		app = built;
		const staff = await signupOwner(app, { email: STAFF_EMAIL });
		await repos.accounts.setChannelConfig(staff.account.id, 'sms', {
			enabled: true,
			address: '+14155550100',
			providerRef: NUMBER_SID,
		});
		const res = await app.inject({
			method: 'POST',
			url: RELEASE_URL,
			headers: authHeader(staff.token),
			payload: {},
		});
		expect(res.statusCode).toBe(409);
		const account = await repos.accounts.findById(staff.account.id);
		expect(account?.channels.sms).toMatchObject({
			enabled: true,
			address: '+14155550100',
			providerRef: NUMBER_SID,
		});
	});

	it('clears sandbox and dev-fake channels without ever calling the provider', async () => {
		const releaser = new RecordingNumberReleaser();
		const { app: built, repos } = await buildTestAppWithRepos({
			config: devConfig(),
			numberReleaser: releaser,
		});
		app = built;
		const staff = await signupOwner(app, { email: STAFF_EMAIL });
		await repos.accounts.setChannelConfig(staff.account.id, 'whatsapp', {
			enabled: true,
			address: TWILIO_WHATSAPP_SANDBOX_NUMBER,
			providerRef: TWILIO_SANDBOX_PROVIDER_REF,
		});
		await repos.accounts.setChannelConfig(staff.account.id, 'sms', {
			enabled: true,
			address: '+15551234567',
			providerRef: 'noop',
		});
		const res = await app.inject({
			method: 'POST',
			url: RELEASE_URL,
			headers: authHeader(staff.token),
			payload: {},
		});
		expect(res.statusCode).toBe(200);
		// Neither the shared sandbox number nor a dev fake is a rental to release —
		// and clearing them is not "forgetting" anything either.
		expect(releaser.releases).toEqual([]);
		expect(res.json().released).toEqual([]);
		expect(res.json().forgotten).toEqual([]);
		const account = await repos.accounts.findById(staff.account.id);
		expect(account?.channels.whatsapp).toMatchObject({ enabled: false, address: '' });
		expect(account?.channels.sms).toMatchObject({ enabled: false, address: '' });
	});

	it('is a harmless no-op on an account with no numbers at all', async () => {
		const releaser = new RecordingNumberReleaser();
		app = await buildTestApp({ config: devConfig(), numberReleaser: releaser });
		const staff = await signupOwner(app, { email: STAFF_EMAIL });
		const res = await app.inject({
			method: 'POST',
			url: RELEASE_URL,
			headers: authHeader(staff.token),
			payload: {},
		});
		expect(res.statusCode).toBe(200);
		expect(releaser.releases).toEqual([]);
		expect(res.json().released).toEqual([]);
	});
});

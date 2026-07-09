import { faker } from '@faker-js/faker';
import type { AccountId } from '@rivus/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import type { ChannelProvisioner } from '../src/services/channel-provisioning';
import { addMember, authHeader, buildTestApp, buildTestAppWithRepos, signupOwner } from './helpers';

const ENABLE = '/v1/account/channels/whatsapp/enable';
const DISABLE = '/v1/account/channels/whatsapp/disable';
const ENABLE_SMS = '/v1/account/channels/sms/enable';
const DISABLE_SMS = '/v1/account/channels/sms/disable';

describe('account channel provisioning', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('provisions and persists a number when the owner enables WhatsApp', async () => {
		app = await buildTestApp();
		const owner = await signupOwner(app);
		const res = await app.inject({ method: 'POST', url: ENABLE, headers: authHeader(owner.token) });
		expect(res.statusCode).toBe(200);
		const whatsapp = res.json().channels.whatsapp;
		expect(whatsapp.enabled).toBe(true);
		expect(whatsapp.address).toMatch(/^\+1555\d{7}$/);
		// The public shape never leaks the provider reference.
		expect(whatsapp.providerRef).toBeUndefined();
	});

	it('is idempotent — re-enabling returns the same number', async () => {
		app = await buildTestApp();
		const owner = await signupOwner(app);
		const first = await app.inject({
			method: 'POST',
			url: ENABLE,
			headers: authHeader(owner.token),
		});
		const second = await app.inject({
			method: 'POST',
			url: ENABLE,
			headers: authHeader(owner.token),
		});
		expect(second.statusCode).toBe(200);
		expect(second.json().channels.whatsapp.address).toBe(first.json().channels.whatsapp.address);
	});

	it('retains the number when disabled and restores it on re-enable', async () => {
		app = await buildTestApp();
		const owner = await signupOwner(app);
		const enabled = await app.inject({
			method: 'POST',
			url: ENABLE,
			headers: authHeader(owner.token),
		});
		const number = enabled.json().channels.whatsapp.address;

		const disabled = await app.inject({
			method: 'POST',
			url: DISABLE,
			headers: authHeader(owner.token),
		});
		expect(disabled.statusCode).toBe(200);
		expect(disabled.json().channels.whatsapp).toMatchObject({ enabled: false, address: number });

		const reEnabled = await app.inject({
			method: 'POST',
			url: ENABLE,
			headers: authHeader(owner.token),
		});
		expect(reEnabled.json().channels.whatsapp).toMatchObject({ enabled: true, address: number });
	});

	it('forbids a non-owner from enabling a channel', async () => {
		app = await buildTestApp();
		const owner = await signupOwner(app);
		const member = await addMember(app, owner.token, 'member', faker.internet.email());
		const res = await app.inject({
			method: 'POST',
			url: ENABLE,
			headers: authHeader(member.token),
		});
		expect(res.statusCode).toBe(403);
	});

	it('returns 502 and persists nothing when provisioning fails', async () => {
		const failingProvisioner: ChannelProvisioner = {
			async provision() {
				throw new Error('provider down');
			},
		};
		app = await buildTestApp({ whatsappProvisioner: failingProvisioner });
		const owner = await signupOwner(app);
		const res = await app.inject({ method: 'POST', url: ENABLE, headers: authHeader(owner.token) });
		expect(res.statusCode).toBe(502);
		// The account is untouched — the channel stays off.
		const me = await app.inject({
			method: 'GET',
			url: '/v1/auth/me',
			headers: authHeader(owner.token),
		});
		expect(me.json().account.channels.whatsapp.enabled).toBe(false);
	});

	it('rejects an unknown channel (400)', async () => {
		app = await buildTestApp();
		const owner = await signupOwner(app);
		const unknown = await app.inject({
			method: 'POST',
			url: '/v1/account/channels/email/enable',
			headers: authHeader(owner.token),
		});
		expect(unknown.statusCode).toBe(400);
	});

	it('provisions voice like the other channels', async () => {
		app = await buildTestApp();
		const owner = await signupOwner(app);
		const enabled = await app.inject({
			method: 'POST',
			url: '/v1/account/channels/voice/enable',
			headers: authHeader(owner.token),
		});
		expect(enabled.statusCode).toBe(200);
		expect(enabled.json().channels.voice.enabled).toBe(true);
		expect(enabled.json().channels.voice.address).toMatch(/^\+1555\d{7}$/);
	});

	it('provisions, disables, and restores an SMS number like WhatsApp', async () => {
		app = await buildTestApp();
		const owner = await signupOwner(app);
		const enabled = await app.inject({
			method: 'POST',
			url: ENABLE_SMS,
			headers: authHeader(owner.token),
		});
		expect(enabled.statusCode).toBe(200);
		const number = enabled.json().channels.sms.address;
		expect(number).toMatch(/^\+1555\d{7}$/);

		const disabled = await app.inject({
			method: 'POST',
			url: DISABLE_SMS,
			headers: authHeader(owner.token),
		});
		expect(disabled.json().channels.sms).toMatchObject({ enabled: false, address: number });

		const reEnabled = await app.inject({
			method: 'POST',
			url: ENABLE_SMS,
			headers: authHeader(owner.token),
		});
		expect(reEnabled.json().channels.sms).toMatchObject({ enabled: true, address: number });
	});
});

describe('one provider-owned number shared across channels', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	// Adoption requires the number's owning provider to be configured (an
	// unconfigured owner can neither send from nor receive on the number), so
	// each case states which providers the deployment has.
	function configuredWith(env: Record<string, string>) {
		return loadConfig({
			NODE_ENV: 'test',
			JWT_SECRET: 'test-secret-value-1234',
			...env,
		} as NodeJS.ProcessEnv);
	}
	const PLIVO_CREDS = { PLIVO_AUTH_ID: 'MA_X', PLIVO_AUTH_TOKEN: 'plivo-token' };
	const TWILIO_CREDS = {
		TWILIO_ACCOUNT_SID: 'ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
		TWILIO_AUTH_TOKEN: 'twilio-token',
	};

	it('enabling SMS adopts the WhatsApp channel’s Plivo-owned number', async () => {
		const { app: built, repos } = await buildTestAppWithRepos({
			config: configuredWith(PLIVO_CREDS),
		});
		app = built;
		const owner = await signupOwner(app);
		// A Plivo-provisioned WhatsApp number: providerRef is the bare digits.
		await repos.accounts.setChannelConfig(owner.account.id as AccountId, 'whatsapp', {
			enabled: true,
			address: '+14155550100',
			providerRef: '14155550100',
		});
		const res = await app.inject({
			method: 'POST',
			url: ENABLE_SMS,
			headers: authHeader(owner.token),
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().channels.sms).toMatchObject({ enabled: true, address: '+14155550100' });
	});

	it('enabling WhatsApp adopts the SMS channel’s Plivo-owned number (either direction)', async () => {
		const { app: built, repos } = await buildTestAppWithRepos({
			config: configuredWith(PLIVO_CREDS),
		});
		app = built;
		const owner = await signupOwner(app);
		await repos.accounts.setChannelConfig(owner.account.id as AccountId, 'sms', {
			enabled: true,
			address: '+14155550101',
			providerRef: '14155550101',
		});
		const res = await app.inject({ method: 'POST', url: ENABLE, headers: authHeader(owner.token) });
		expect(res.statusCode).toBe(200);
		expect(res.json().channels.whatsapp).toMatchObject({
			enabled: true,
			address: '+14155550101',
		});
	});

	it('refuses a number another account already holds on the sibling channel (409)', async () => {
		// A provisioner (mis)assigning a number account A already holds on WhatsApp.
		const doubleAssigning: ChannelProvisioner = {
			async provision() {
				return { address: '+14155550100', providerRef: '14155550100' };
			},
		};
		const { app: built, repos } = await buildTestAppWithRepos({ smsProvisioner: doubleAssigning });
		app = built;
		const accountA = await signupOwner(app);
		await repos.accounts.setChannelConfig(accountA.account.id as AccountId, 'whatsapp', {
			enabled: true,
			address: '+14155550100',
			providerRef: '14155550100',
		});
		const accountB = await signupOwner(app);
		const res = await app.inject({
			method: 'POST',
			url: ENABLE_SMS,
			headers: authHeader(accountB.token),
		});
		expect(res.statusCode).toBe(409);
		// Nothing was persisted for account B.
		const me = await app.inject({
			method: 'GET',
			url: '/v1/auth/me',
			headers: authHeader(accountB.token),
		});
		expect(me.json().account.channels.sms.enabled).toBe(false);
	});

	it('enabling voice adopts the account’s Plivo-owned messaging number', async () => {
		const { app: built, repos } = await buildTestAppWithRepos({
			config: configuredWith(PLIVO_CREDS),
		});
		app = built;
		const owner = await signupOwner(app);
		await repos.accounts.setChannelConfig(owner.account.id as AccountId, 'sms', {
			enabled: true,
			address: '+14155550103',
			providerRef: '14155550103',
		});
		const res = await app.inject({
			method: 'POST',
			url: '/v1/account/channels/voice/enable',
			headers: authHeader(owner.token),
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().channels.voice).toMatchObject({ enabled: true, address: '+14155550103' });
	});

	it('enabling SMS adopts the WhatsApp channel’s Twilio-owned number (PN ref)', async () => {
		const { app: built, repos } = await buildTestAppWithRepos({
			config: configuredWith(TWILIO_CREDS),
		});
		app = built;
		const owner = await signupOwner(app);
		const accountId = owner.account.id as AccountId;
		// A Twilio-provisioned number: providerRef is the PN… phone-number SID.
		await repos.accounts.setChannelConfig(accountId, 'whatsapp', {
			enabled: true,
			address: '+14155550104',
			providerRef: 'PN0123456789abcdef0123456789abcdef',
		});
		const res = await app.inject({
			method: 'POST',
			url: ENABLE_SMS,
			headers: authHeader(owner.token),
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().channels.sms).toMatchObject({ enabled: true, address: '+14155550104' });
		// The fingerprint rode along, so outbound SMS routes through Twilio.
		const account = await repos.accounts.findById(accountId);
		expect(account?.channels.sms.providerRef).toBe('PN0123456789abcdef0123456789abcdef');
	});

	it('never shares a number neither phone provider owns (zernio ids, dev fakes)', async () => {
		// Both providers configured — the only reason not to share is the ref shape.
		const { app: built, repos } = await buildTestAppWithRepos({
			config: configuredWith({ ...PLIVO_CREDS, ...TWILIO_CREDS }),
		});
		app = built;
		const owner = await signupOwner(app);
		// A zernio-provisioned WhatsApp number: opaque providerRef, not bare digits.
		await repos.accounts.setChannelConfig(owner.account.id as AccountId, 'whatsapp', {
			enabled: true,
			address: '+14155550102',
			providerRef: 'zwa_42',
		});
		const res = await app.inject({
			method: 'POST',
			url: ENABLE_SMS,
			headers: authHeader(owner.token),
		});
		expect(res.statusCode).toBe(200);
		// A fresh (deterministic dev) number was provisioned instead.
		const smsAddress = res.json().channels.sms.address;
		expect(smsAddress).toMatch(/^\+1555\d{7}$/);
		expect(smsAddress).not.toBe('+14155550102');
	});

	it('rents fresh instead of adopting a number whose provider is no longer configured', async () => {
		// Only Twilio configured; the sibling holds a Plivo-owned number. Adopting
		// it would enable a channel that can neither send nor receive — a fresh
		// number through the configured primary keeps the new channel working.
		const { app: built, repos } = await buildTestAppWithRepos({
			config: configuredWith(TWILIO_CREDS),
		});
		app = built;
		const owner = await signupOwner(app);
		await repos.accounts.setChannelConfig(owner.account.id as AccountId, 'whatsapp', {
			enabled: true,
			address: '+14155550105',
			providerRef: '14155550105',
		});
		const res = await app.inject({
			method: 'POST',
			url: ENABLE_SMS,
			headers: authHeader(owner.token),
		});
		expect(res.statusCode).toBe(200);
		const smsAddress = res.json().channels.sms.address;
		expect(smsAddress).toMatch(/^\+1555\d{7}$/);
		expect(smsAddress).not.toBe('+14155550105');
	});
});

describe('production refuses channels with no configured provider', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	function productionConfig(extra: Record<string, string> = {}) {
		return loadConfig({
			NODE_ENV: 'production',
			JWT_SECRET: 'x'.repeat(32),
			RESEND_API_KEY: 're_test_key',
			LOG_LEVEL: 'silent',
			CORS_ORIGIN: 'https://app.rivus.ai',
			...extra,
		} as NodeJS.ProcessEnv);
	}

	it('503s SMS enable without Plivo, even when zernio serves WhatsApp', async () => {
		app = await buildTestApp({ config: productionConfig({ ZERNIO_API_KEY: 'zk_1' }) });
		const owner = await signupOwner(app);
		const sms = await app.inject({
			method: 'POST',
			url: ENABLE_SMS,
			headers: authHeader(owner.token),
		});
		expect(sms.statusCode).toBe(503);
		// WhatsApp has a real provider (zernio) and still provisions.
		const whatsapp = await app.inject({
			method: 'POST',
			url: ENABLE,
			headers: authHeader(owner.token),
		});
		expect(whatsapp.statusCode).toBe(200);
	});

	it('503s both channels when no provider is configured at all', async () => {
		app = await buildTestApp({ config: productionConfig() });
		const owner = await signupOwner(app);
		for (const url of [ENABLE, ENABLE_SMS]) {
			const res = await app.inject({ method: 'POST', url, headers: authHeader(owner.token) });
			expect(res.statusCode).toBe(503);
		}
	});

	it('allows both channels when Plivo is configured', async () => {
		app = await buildTestApp({
			config: productionConfig({ PLIVO_AUTH_ID: 'MA_X', PLIVO_AUTH_TOKEN: 'tok' }),
		});
		const owner = await signupOwner(app);
		const res = await app.inject({
			method: 'POST',
			url: ENABLE_SMS,
			headers: authHeader(owner.token),
		});
		// The injected (noop) provisioner answers; the config gate passed.
		expect(res.statusCode).toBe(200);
	});

	it('allows every channel when only Twilio is configured', async () => {
		app = await buildTestApp({
			config: productionConfig({
				TWILIO_ACCOUNT_SID: 'ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
				TWILIO_AUTH_TOKEN: 'twilio-token',
			}),
		});
		const owner = await signupOwner(app);
		for (const url of [ENABLE, ENABLE_SMS, '/v1/account/channels/voice/enable']) {
			const res = await app.inject({ method: 'POST', url, headers: authHeader(owner.token) });
			expect(res.statusCode).toBe(200);
		}
	});

	it('503s on a partial Twilio credential pair (sid without token)', async () => {
		app = await buildTestApp({
			config: productionConfig({ TWILIO_ACCOUNT_SID: 'ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' }),
		});
		const owner = await signupOwner(app);
		const res = await app.inject({
			method: 'POST',
			url: ENABLE_SMS,
			headers: authHeader(owner.token),
		});
		expect(res.statusCode).toBe(503);
	});
});

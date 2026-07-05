import { faker } from '@faker-js/faker';
import type { AccountId } from '@rivus/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
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

	it('rejects an unknown channel (400) and a not-yet-available one (400)', async () => {
		app = await buildTestApp();
		const owner = await signupOwner(app);
		const unknown = await app.inject({
			method: 'POST',
			url: '/v1/account/channels/email/enable',
			headers: authHeader(owner.token),
		});
		expect(unknown.statusCode).toBe(400);
		const notYet = await app.inject({
			method: 'POST',
			url: '/v1/account/channels/voice/enable',
			headers: authHeader(owner.token),
		});
		expect(notYet.statusCode).toBe(400);
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

describe('one Plivo number shared across channels', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('enabling SMS adopts the WhatsApp channel’s Plivo-owned number', async () => {
		const { app: built, repos } = await buildTestAppWithRepos();
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
		const { app: built, repos } = await buildTestAppWithRepos();
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

	it('never shares a number Plivo does not own (zernio ids, dev fakes)', async () => {
		const { app: built, repos } = await buildTestAppWithRepos();
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
});

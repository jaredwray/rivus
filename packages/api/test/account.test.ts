import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addMember, authHeader, buildTestApp, signupOwner } from './helpers';

describe('account settings', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		app = await buildTestApp();
	});

	afterEach(async () => {
		await app.close();
	});

	function updateAccount(token: string, payload: Record<string, unknown>) {
		return app.inject({
			method: 'PATCH',
			url: '/v1/account',
			headers: authHeader(token),
			payload,
		});
	}

	it('requires authentication', async () => {
		const response = await app.inject({
			method: 'PATCH',
			url: '/v1/account',
			payload: { businessName: 'Nope' },
		});
		expect(response.statusCode).toBe(401);
	});

	it('lets an owner update business settings and reflects them on the session', async () => {
		const owner = await signupOwner(app);
		const response = await updateAccount(owner.token, {
			businessName: 'Cascade Plumbing & Heating',
			phone: '+1 206 555 0100',
			timezone: 'America/Los_Angeles',
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			name: 'Cascade Plumbing & Heating',
			phone: '+1 206 555 0100',
			timezone: 'America/Los_Angeles',
			status: 'active',
		});

		const me = await app.inject({
			method: 'GET',
			url: '/v1/auth/me',
			headers: authHeader(owner.token),
		});
		expect(me.json().account).toMatchObject({
			name: 'Cascade Plumbing & Heating',
			phone: '+1 206 555 0100',
		});
	});

	it('applies a partial update without blanking untouched fields', async () => {
		const owner = await signupOwner(app, { businessName: 'Acme Co' });
		await updateAccount(owner.token, { phone: '+1 555 0001' });
		const response = await updateAccount(owner.token, { address: '1 Main St' });

		expect(response.statusCode).toBe(200);
		// The earlier phone survives an address-only update; the name is untouched too.
		expect(response.json()).toMatchObject({
			name: 'Acme Co',
			phone: '+1 555 0001',
			address: '1 Main St',
		});
	});

	it('rejects an empty update (400)', async () => {
		const owner = await signupOwner(app);
		const response = await updateAccount(owner.token, {});
		expect(response.statusCode).toBe(400);
	});

	it('forbids a manager from updating account settings (403)', async () => {
		const owner = await signupOwner(app);
		const manager = await addMember(app, owner.token, 'manager', 'mgr@example.com');
		const response = await updateAccount(manager.token, { businessName: 'Hijack' });
		expect(response.statusCode).toBe(403);
	});

	it('forbids a member from updating account settings (403)', async () => {
		const owner = await signupOwner(app);
		const member = await addMember(app, owner.token, 'member', 'tm@example.com');
		const response = await updateAccount(member.token, { businessName: 'Hijack' });
		expect(response.statusCode).toBe(403);
	});
});

describe('account cancellation (soft delete)', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		app = await buildTestApp();
	});

	afterEach(async () => {
		await app.close();
	});

	function cancel(token: string) {
		return app.inject({ method: 'POST', url: '/v1/account/cancel', headers: authHeader(token) });
	}

	it('lets an owner cancel the account and marks it canceled', async () => {
		const owner = await signupOwner(app);
		const response = await cancel(owner.token);

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.status).toBe('canceled');
		expect(body.canceledAt).toBeTypeOf('string');
	});

	it("locks out the owner's own token once the account is canceled", async () => {
		const owner = await signupOwner(app);
		await cancel(owner.token);

		const after = await app.inject({
			method: 'GET',
			url: '/v1/auth/me',
			headers: authHeader(owner.token),
		});
		expect(after.statusCode).toBe(401);
	});

	it('locks out every member of a canceled account', async () => {
		const owner = await signupOwner(app);
		const member = await addMember(app, owner.token, 'member', 'tm@example.com');
		await cancel(owner.token);

		const memberMe = await app.inject({
			method: 'GET',
			url: '/v1/items',
			headers: authHeader(member.token),
		});
		expect(memberMe.statusCode).toBe(401);
	});

	it('retains the account data (soft delete, not a purge)', async () => {
		const owner = await signupOwner(app);
		await cancel(owner.token);
		// The row is still present in the store, just flagged canceled.
		const stored = await app.deps.accounts.findById(owner.account.id);
		expect(stored?.status).toBe('canceled');
	});

	it('refuses to accept a pending invite once the account is canceled (401)', async () => {
		const owner = await signupOwner(app);
		// Create a pending invite, then cancel the account before it is accepted.
		const inviteToken = (
			await app.inject({
				method: 'POST',
				url: '/v1/members/invites',
				headers: authHeader(owner.token),
				payload: { email: 'late@example.com', name: 'Late', role: 'member' },
			})
		).json().token;
		await cancel(owner.token);

		const accepted = await app.inject({
			method: 'POST',
			url: '/v1/auth/accept-invite',
			payload: { token: inviteToken },
		});
		expect(accepted.statusCode).toBe(401);
	});

	it('forbids a manager from canceling the account (403)', async () => {
		const owner = await signupOwner(app);
		const manager = await addMember(app, owner.token, 'manager', 'mgr@example.com');
		const response = await cancel(manager.token);
		expect(response.statusCode).toBe(403);
	});

	it('forbids a member from canceling the account (403)', async () => {
		const owner = await signupOwner(app);
		const member = await addMember(app, owner.token, 'member', 'tm@example.com');
		const response = await cancel(member.token);
		expect(response.statusCode).toBe(403);
	});
});

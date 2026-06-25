import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addMember, authHeader, buildTestApp, signupOwner } from './helpers';

describe('billing', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		app = await buildTestApp();
	});

	afterEach(async () => {
		await app.close();
	});

	function getBilling(token: string) {
		return app.inject({ method: 'GET', url: '/v1/billing', headers: authHeader(token) });
	}

	it('requires authentication', async () => {
		const response = await app.inject({ method: 'GET', url: '/v1/billing' });
		expect(response.statusCode).toBe(401);
	});

	it('returns the free-plan placeholder with the seat (member) count for an owner', async () => {
		const owner = await signupOwner(app);
		const response = await getBilling(owner.token);

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ plan: 'free', status: 'active', seats: 1 });
	});

	it('counts every member as a seat', async () => {
		const owner = await signupOwner(app);
		await addMember(app, owner.token, 'manager', 'mgr@example.com');
		await addMember(app, owner.token, 'member', 'tm@example.com');

		const response = await getBilling(owner.token);
		expect(response.json().seats).toBe(3);
	});

	it('forbids a manager from viewing billing (403)', async () => {
		const owner = await signupOwner(app);
		const manager = await addMember(app, owner.token, 'manager', 'mgr@example.com');
		const response = await getBilling(manager.token);
		expect(response.statusCode).toBe(403);
	});

	it('forbids a member from viewing billing (403)', async () => {
		const owner = await signupOwner(app);
		const member = await addMember(app, owner.token, 'member', 'tm@example.com');
		const response = await getBilling(member.token);
		expect(response.statusCode).toBe(403);
	});
});

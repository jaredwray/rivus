import { faker } from '@faker-js/faker';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, signupOwner } from './helpers';

const STAFF_EMAIL = 'ops@rivus.ai';

function submitDemoLead(app: FastifyInstance, payload: Record<string, unknown>) {
	return app.inject({ method: 'POST', url: '/v1/leads/demo', payload });
}

describe('POST /v1/leads/demo (public)', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		app = await buildTestApp();
	});

	afterEach(async () => {
		await app.close();
	});

	it('accepts a minimal request without auth and answers an opaque receipt', async () => {
		const response = await submitDemoLead(app, {
			name: 'Dana Fox',
			email: 'Dana@Example.com',
		});

		expect(response.statusCode).toBe(201);
		expect(response.json()).toEqual({ status: 'received' });
	});

	it('stores the full context (normalized email, defaults applied)', async () => {
		await submitDemoLead(app, {
			name: 'Dana Fox',
			email: ' Dana@Example.com ',
			business: 'Fox Plumbing',
			phone: '(555) 123-4567',
			trade: 'Plumber',
		});

		const staffToken = (await signupOwner(app, { email: STAFF_EMAIL })).token;
		const listed = await app.inject({
			method: 'GET',
			url: '/v1/leads/demo',
			headers: authHeader(staffToken),
		});
		const [lead] = listed.json().data;
		expect(lead).toMatchObject({
			name: 'Dana Fox',
			email: 'dana@example.com',
			business: 'Fox Plumbing',
			phone: '(555) 123-4567',
			trade: 'Plumber',
			source: 'website-demo',
		});
		expect(lead.id).toBeTruthy();
		expect(lead.createdAt).toBeTruthy();
	});

	it('rejects a missing email with a friendly message', async () => {
		const response = await submitDemoLead(app, { name: 'Dana Fox' });

		expect(response.statusCode).toBe(400);
		expect(response.json().message).toBe('Email address is required.');
	});

	it('rejects an unknown source instead of storing free text', async () => {
		const response = await submitDemoLead(app, {
			name: 'Dana Fox',
			email: 'dana@example.com',
			source: 'billboard',
		});

		expect(response.statusCode).toBe(400);
	});
});

describe('GET /v1/leads/demo (staff only)', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		app = await buildTestApp();
	});

	afterEach(async () => {
		await app.close();
	});

	it('requires auth', async () => {
		const response = await app.inject({ method: 'GET', url: '/v1/leads/demo' });
		expect(response.statusCode).toBe(401);
	});

	it('rejects a signed-in non-staff owner with 403', async () => {
		const owner = await signupOwner(app);
		const response = await app.inject({
			method: 'GET',
			url: '/v1/leads/demo',
			headers: authHeader(owner.token),
		});
		expect(response.statusCode).toBe(403);
	});

	it('pages leads newest-first for staff', async () => {
		for (let index = 0; index < 3; index++) {
			await submitDemoLead(app, {
				name: `Lead ${index}`,
				email: faker.internet.email().toLowerCase(),
			});
		}
		const staffToken = (await signupOwner(app, { email: STAFF_EMAIL })).token;

		const firstPage = await app.inject({
			method: 'GET',
			url: '/v1/leads/demo?page=1&pageSize=2',
			headers: authHeader(staffToken),
		});
		expect(firstPage.statusCode).toBe(200);
		const body = firstPage.json();
		expect(body.meta.total).toBe(3);
		expect(body.data.map((lead: { name: string }) => lead.name)).toEqual(['Lead 2', 'Lead 1']);

		const secondPage = await app.inject({
			method: 'GET',
			url: '/v1/leads/demo?page=2&pageSize=2',
			headers: authHeader(staffToken),
		});
		expect(secondPage.json().data.map((lead: { name: string }) => lead.name)).toEqual(['Lead 0']);
	});
});

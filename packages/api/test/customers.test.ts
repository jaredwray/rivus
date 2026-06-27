import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, signupOwner } from './helpers';

describe('customers', () => {
	let app: FastifyInstance;
	let token: string;

	beforeEach(async () => {
		app = await buildTestApp();
		token = (await signupOwner(app)).token;
	});

	afterEach(async () => {
		await app.close();
	});

	async function createCustomer(name: string, extra: Record<string, unknown> = {}) {
		return app.inject({
			method: 'POST',
			url: '/v1/customers',
			headers: authHeader(token),
			payload: { name, ...extra },
		});
	}

	it('requires authentication', async () => {
		const response = await app.inject({ method: 'GET', url: '/v1/customers' });
		expect(response.statusCode).toBe(401);
	});

	it('creates a customer with defaults', async () => {
		const response = await createCustomer('Grace Kim');

		expect(response.statusCode).toBe(201);
		expect(response.json()).toMatchObject({
			name: 'Grace Kim',
			email: '',
			phone: '',
			address: '',
			lifetimeValue: 0,
			balance: 0,
			notes: '',
		});
		expect(response.json().id).toBeTypeOf('string');
	});

	it('creates a customer with a full CRM record', async () => {
		const response = await createCustomer('Priya Anand', {
			email: 'Priya@Example.com',
			phone: '(206) 555-0119',
			address: 'Capitol Hill',
			lifetimeValue: 526_000,
			balance: 54_000,
			notes: 'Billing flag',
		});

		expect(response.statusCode).toBe(201);
		expect(response.json()).toMatchObject({
			name: 'Priya Anand',
			email: 'priya@example.com',
			lifetimeValue: 526_000,
			balance: 54_000,
		});
	});

	it('rejects a create with no name (400)', async () => {
		const response = await app.inject({
			method: 'POST',
			url: '/v1/customers',
			headers: authHeader(token),
			payload: { address: 'orphan' },
		});

		expect(response.statusCode).toBe(400);
	});

	it('rejects a create with negative money (400)', async () => {
		const response = await createCustomer('Bad Balance', { balance: -1 });
		expect(response.statusCode).toBe(400);
	});

	it('rejects a create with a malformed email (400)', async () => {
		const response = await createCustomer('Bad Email', { email: 'not-an-email' });
		expect(response.statusCode).toBe(400);
	});

	it('lists customers newest-first with pagination metadata', async () => {
		await createCustomer('one');
		await createCustomer('two');
		await createCustomer('three');

		const response = await app.inject({
			method: 'GET',
			url: '/v1/customers?page=1&pageSize=2',
			headers: authHeader(token),
		});

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.data).toHaveLength(2);
		expect(body.meta).toMatchObject({
			page: 1,
			pageSize: 2,
			total: 3,
			totalPages: 2,
			hasNextPage: true,
			hasPreviousPage: false,
		});
		expect(body.data[0].name).toBe('three');
	});

	it('fetches a single customer by id', async () => {
		const created = await createCustomer('findable');
		const id = created.json().id;

		const response = await app.inject({
			method: 'GET',
			url: `/v1/customers/${id}`,
			headers: authHeader(token),
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().id).toBe(id);
	});

	it('returns 404 for an unknown id', async () => {
		const response = await app.inject({
			method: 'GET',
			url: '/v1/customers/does-not-exist',
			headers: authHeader(token),
		});

		expect(response.statusCode).toBe(404);
	});

	it('updates a customer', async () => {
		const created = await createCustomer('before', { balance: 5_000 });
		const id = created.json().id;

		const response = await app.inject({
			method: 'PATCH',
			url: `/v1/customers/${id}`,
			headers: authHeader(token),
			payload: { balance: 21_000 },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({ name: 'before', balance: 21_000 });
	});

	it('rejects an empty update (400)', async () => {
		const created = await createCustomer('immutable');
		const id = created.json().id;

		const response = await app.inject({
			method: 'PATCH',
			url: `/v1/customers/${id}`,
			headers: authHeader(token),
			payload: {},
		});

		expect(response.statusCode).toBe(400);
	});

	it('deletes a customer, after which it is gone', async () => {
		const created = await createCustomer('temporary');
		const id = created.json().id;

		const deleteResponse = await app.inject({
			method: 'DELETE',
			url: `/v1/customers/${id}`,
			headers: authHeader(token),
		});
		expect(deleteResponse.statusCode).toBe(204);

		const getResponse = await app.inject({
			method: 'GET',
			url: `/v1/customers/${id}`,
			headers: authHeader(token),
		});
		expect(getResponse.statusCode).toBe(404);
	});

	it('does not leak customers across owners', async () => {
		const created = await createCustomer('private');
		const id = created.json().id;

		const otherToken = (await signupOwner(app)).token;
		const response = await app.inject({
			method: 'GET',
			url: `/v1/customers/${id}`,
			headers: authHeader(otherToken),
		});

		expect(response.statusCode).toBe(404);
	});

	it('does not let another owner update a customer', async () => {
		const created = await createCustomer('private');
		const id = created.json().id;
		const otherToken = (await signupOwner(app)).token;

		const response = await app.inject({
			method: 'PATCH',
			url: `/v1/customers/${id}`,
			headers: authHeader(otherToken),
			payload: { name: 'hijacked' },
		});

		expect(response.statusCode).toBe(404);
	});

	it('does not let another owner delete a customer', async () => {
		const created = await createCustomer('private');
		const id = created.json().id;
		const otherToken = (await signupOwner(app)).token;

		const response = await app.inject({
			method: 'DELETE',
			url: `/v1/customers/${id}`,
			headers: authHeader(otherToken),
		});

		expect(response.statusCode).toBe(404);
	});
});

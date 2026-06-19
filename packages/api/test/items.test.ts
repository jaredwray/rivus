import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, registerUser } from './helpers';

describe('items', () => {
	let app: FastifyInstance;
	let token: string;

	beforeEach(async () => {
		app = await buildTestApp();
		token = (await registerUser(app)).token;
	});

	afterEach(async () => {
		await app.close();
	});

	async function createItem(name: string, extra: Record<string, unknown> = {}) {
		return app.inject({
			method: 'POST',
			url: '/v1/items',
			headers: authHeader(token),
			payload: { name, ...extra },
		});
	}

	it('requires authentication', async () => {
		const response = await app.inject({ method: 'GET', url: '/v1/items' });
		expect(response.statusCode).toBe(401);
	});

	it('creates an item with defaults', async () => {
		const response = await createItem('First item');

		expect(response.statusCode).toBe(201);
		expect(response.json()).toMatchObject({
			name: 'First item',
			description: '',
			status: 'active',
		});
		expect(response.json().id).toBeTypeOf('string');
	});

	it('rejects a create with no name (400)', async () => {
		const response = await app.inject({
			method: 'POST',
			url: '/v1/items',
			headers: authHeader(token),
			payload: { description: 'orphan' },
		});

		expect(response.statusCode).toBe(400);
	});

	it('lists items newest-first with pagination metadata', async () => {
		await createItem('one');
		await createItem('two');
		await createItem('three');

		const response = await app.inject({
			method: 'GET',
			url: '/v1/items?page=1&pageSize=2',
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

	it('fetches a single item by id', async () => {
		const created = await createItem('findable');
		const id = created.json().id;

		const response = await app.inject({
			method: 'GET',
			url: `/v1/items/${id}`,
			headers: authHeader(token),
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().id).toBe(id);
	});

	it('returns 404 for an unknown id', async () => {
		const response = await app.inject({
			method: 'GET',
			url: '/v1/items/does-not-exist',
			headers: authHeader(token),
		});

		expect(response.statusCode).toBe(404);
	});

	it('updates an item', async () => {
		const created = await createItem('before');
		const id = created.json().id;

		const response = await app.inject({
			method: 'PATCH',
			url: `/v1/items/${id}`,
			headers: authHeader(token),
			payload: { status: 'archived' },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({ name: 'before', status: 'archived' });
	});

	it('rejects an empty update (400)', async () => {
		const created = await createItem('immutable');
		const id = created.json().id;

		const response = await app.inject({
			method: 'PATCH',
			url: `/v1/items/${id}`,
			headers: authHeader(token),
			payload: {},
		});

		expect(response.statusCode).toBe(400);
	});

	it('deletes an item, after which it is gone', async () => {
		const created = await createItem('temporary');
		const id = created.json().id;

		const deleteResponse = await app.inject({
			method: 'DELETE',
			url: `/v1/items/${id}`,
			headers: authHeader(token),
		});
		expect(deleteResponse.statusCode).toBe(204);

		const getResponse = await app.inject({
			method: 'GET',
			url: `/v1/items/${id}`,
			headers: authHeader(token),
		});
		expect(getResponse.statusCode).toBe(404);
	});

	it('does not leak items across owners', async () => {
		const created = await createItem('private');
		const id = created.json().id;

		const otherToken = (await registerUser(app)).token;
		const response = await app.inject({
			method: 'GET',
			url: `/v1/items/${id}`,
			headers: authHeader(otherToken),
		});

		expect(response.statusCode).toBe(404);
	});
});

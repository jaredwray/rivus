import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, signupOwner } from './helpers';

describe('faqs', () => {
	let app: FastifyInstance;
	let token: string;

	beforeEach(async () => {
		app = await buildTestApp();
		token = (await signupOwner(app)).token;
	});

	afterEach(async () => {
		await app.close();
	});

	async function createFaq(question: string, extra: Record<string, unknown> = {}) {
		return app.inject({
			method: 'POST',
			url: '/v1/faqs',
			headers: authHeader(token),
			payload: { question, answer: 'Because we said so.', ...extra },
		});
	}

	it('requires authentication', async () => {
		const response = await app.inject({ method: 'GET', url: '/v1/faqs' });
		expect(response.statusCode).toBe(401);
	});

	it('creates an FAQ with defaults', async () => {
		const response = await createFaq('Do you offer free estimates?');

		expect(response.statusCode).toBe(201);
		expect(response.json()).toMatchObject({
			question: 'Do you offer free estimates?',
			answer: 'Because we said so.',
			category: '',
			status: 'published',
		});
		expect(response.json().id).toBeTypeOf('string');
	});

	it('keeps a provided category and status', async () => {
		const response = await createFaq('What are your hours?', {
			category: 'Scheduling',
			status: 'draft',
		});

		expect(response.statusCode).toBe(201);
		expect(response.json()).toMatchObject({ category: 'Scheduling', status: 'draft' });
	});

	it('rejects a create with no question (400)', async () => {
		const response = await app.inject({
			method: 'POST',
			url: '/v1/faqs',
			headers: authHeader(token),
			payload: { answer: 'An answer with no question.' },
		});

		expect(response.statusCode).toBe(400);
	});

	it('rejects a create with no answer (400)', async () => {
		const response = await app.inject({
			method: 'POST',
			url: '/v1/faqs',
			headers: authHeader(token),
			payload: { question: 'A question with no answer?' },
		});

		expect(response.statusCode).toBe(400);
	});

	it('lists FAQs newest-first with pagination metadata', async () => {
		await createFaq('one');
		await createFaq('two');
		await createFaq('three');

		const response = await app.inject({
			method: 'GET',
			url: '/v1/faqs?page=1&pageSize=2',
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
		expect(body.data[0].question).toBe('three');
	});

	it('fetches a single FAQ by id', async () => {
		const created = await createFaq('findable');
		const id = created.json().id;

		const response = await app.inject({
			method: 'GET',
			url: `/v1/faqs/${id}`,
			headers: authHeader(token),
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().id).toBe(id);
	});

	it('returns 404 for an unknown id', async () => {
		const response = await app.inject({
			method: 'GET',
			url: '/v1/faqs/does-not-exist',
			headers: authHeader(token),
		});

		expect(response.statusCode).toBe(404);
	});

	it('updates an FAQ', async () => {
		const created = await createFaq('before');
		const id = created.json().id;

		const response = await app.inject({
			method: 'PATCH',
			url: `/v1/faqs/${id}`,
			headers: authHeader(token),
			payload: { status: 'draft' },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({ question: 'before', status: 'draft' });
	});

	it('rejects an empty update (400)', async () => {
		const created = await createFaq('immutable');
		const id = created.json().id;

		const response = await app.inject({
			method: 'PATCH',
			url: `/v1/faqs/${id}`,
			headers: authHeader(token),
			payload: {},
		});

		expect(response.statusCode).toBe(400);
	});

	it('deletes an FAQ, after which it is gone', async () => {
		const created = await createFaq('temporary');
		const id = created.json().id;

		const deleteResponse = await app.inject({
			method: 'DELETE',
			url: `/v1/faqs/${id}`,
			headers: authHeader(token),
		});
		expect(deleteResponse.statusCode).toBe(204);

		const getResponse = await app.inject({
			method: 'GET',
			url: `/v1/faqs/${id}`,
			headers: authHeader(token),
		});
		expect(getResponse.statusCode).toBe(404);
	});

	it('does not leak FAQs across owners', async () => {
		const created = await createFaq('private');
		const id = created.json().id;

		const otherToken = (await signupOwner(app)).token;
		const response = await app.inject({
			method: 'GET',
			url: `/v1/faqs/${id}`,
			headers: authHeader(otherToken),
		});

		expect(response.statusCode).toBe(404);
	});

	it('does not let another owner update an FAQ', async () => {
		const created = await createFaq('private');
		const id = created.json().id;
		const otherToken = (await signupOwner(app)).token;

		const response = await app.inject({
			method: 'PATCH',
			url: `/v1/faqs/${id}`,
			headers: authHeader(otherToken),
			payload: { question: 'hijacked' },
		});

		expect(response.statusCode).toBe(404);
	});

	it('does not let another owner delete an FAQ', async () => {
		const created = await createFaq('private');
		const id = created.json().id;
		const otherToken = (await signupOwner(app)).token;

		const response = await app.inject({
			method: 'DELETE',
			url: `/v1/faqs/${id}`,
			headers: authHeader(otherToken),
		});

		expect(response.statusCode).toBe(404);
	});
});

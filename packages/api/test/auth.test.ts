import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, fakeCredentials, registerUser } from './helpers';

describe('auth', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		app = await buildTestApp();
	});

	afterEach(async () => {
		await app.close();
	});

	it('registers a user and returns a token plus a hash-free user', async () => {
		const credentials = fakeCredentials();
		const response = await app.inject({
			method: 'POST',
			url: '/v1/auth/register',
			payload: credentials,
		});

		expect(response.statusCode).toBe(201);
		const body = response.json();
		expect(body.token).toBeTypeOf('string');
		expect(body.user.email).toBe(credentials.email);
		expect(body.user).not.toHaveProperty('passwordHash');
		expect(body.user).not.toHaveProperty('password');
	});

	it('rejects a duplicate email with 409', async () => {
		const credentials = fakeCredentials();
		await app.inject({ method: 'POST', url: '/v1/auth/register', payload: credentials });

		const second = await app.inject({
			method: 'POST',
			url: '/v1/auth/register',
			payload: credentials,
		});

		expect(second.statusCode).toBe(409);
		expect(second.json().statusCode).toBe(409);
	});

	it('rejects an invalid email with 400', async () => {
		const response = await app.inject({
			method: 'POST',
			url: '/v1/auth/register',
			payload: { email: 'not-an-email', password: 'supersecret123', name: 'Ada' },
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({ error: 'Bad Request', statusCode: 400 });
	});

	it('rejects a short password with 400', async () => {
		const response = await app.inject({
			method: 'POST',
			url: '/v1/auth/register',
			payload: { email: 'ada@example.com', password: 'short', name: 'Ada' },
		});

		expect(response.statusCode).toBe(400);
	});

	it('logs in with valid credentials', async () => {
		const { credentials } = await registerUser(app);

		const response = await app.inject({
			method: 'POST',
			url: '/v1/auth/login',
			payload: { email: credentials.email, password: credentials.password },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().token).toBeTypeOf('string');
	});

	it('rejects a wrong password with 401', async () => {
		const { credentials } = await registerUser(app);

		const response = await app.inject({
			method: 'POST',
			url: '/v1/auth/login',
			payload: { email: credentials.email, password: 'wrong-password' },
		});

		expect(response.statusCode).toBe(401);
	});

	it('rejects an unknown email with 401', async () => {
		const response = await app.inject({
			method: 'POST',
			url: '/v1/auth/login',
			payload: { email: 'ghost@example.com', password: 'supersecret123' },
		});

		expect(response.statusCode).toBe(401);
	});

	it('returns the current user from /me with a valid token', async () => {
		const { credentials, token } = await registerUser(app);

		const response = await app.inject({
			method: 'GET',
			url: '/v1/auth/me',
			headers: authHeader(token),
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().email).toBe(credentials.email);
	});

	it('rejects /me without a token (401)', async () => {
		const response = await app.inject({ method: 'GET', url: '/v1/auth/me' });

		expect(response.statusCode).toBe(401);
	});

	it('rejects /me with a malformed token (401)', async () => {
		const response = await app.inject({
			method: 'GET',
			url: '/v1/auth/me',
			headers: authHeader('garbage.token.value'),
		});

		expect(response.statusCode).toBe(401);
	});
});

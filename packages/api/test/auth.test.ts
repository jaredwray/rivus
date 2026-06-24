import type { AccountId, UserId } from '@rivus/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConflictError } from '../src/repositories/errors';
import { createInMemoryRepositories } from '../src/repositories/memory';
import { hashPassword } from '../src/services/password';
import {
	authHeader,
	buildTestApp,
	buildTestAppWithRepos,
	fakeSignup,
	signupOwner,
} from './helpers';

function signupPayload(over: Partial<{ email: string; businessName: string }> = {}) {
	const base = fakeSignup();
	return {
		email: over.email ?? base.email,
		password: base.password,
		name: base.name,
		business: { businessName: over.businessName ?? base.businessName },
	};
}

describe('signup', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		app = await buildTestApp();
	});

	afterEach(async () => {
		await app.close();
	});

	it('creates an account, an owner, and returns a session', async () => {
		const payload = signupPayload({ businessName: 'Cascade Plumbing' });
		const response = await app.inject({ method: 'POST', url: '/v1/auth/signup', payload });

		expect(response.statusCode).toBe(201);
		const body = response.json();
		expect(body.token).toBeTypeOf('string');
		expect(body.role).toBe('owner');
		expect(body.user.email).toBe(payload.email);
		expect(body.user).not.toHaveProperty('passwordHash');
		expect(body.account).toMatchObject({
			name: 'Cascade Plumbing',
			slug: 'cascade-plumbing',
			timezone: 'UTC',
		});
	});

	it('carries through the optional business fields', async () => {
		const response = await app.inject({
			method: 'POST',
			url: '/v1/auth/signup',
			payload: {
				...signupPayload(),
				business: {
					businessName: 'Acme',
					phone: '+1 206 555 0100',
					address: '1 Main St',
					website: 'https://acme.example',
					timezone: 'America/Los_Angeles',
				},
			},
		});

		expect(response.statusCode).toBe(201);
		expect(response.json().account).toMatchObject({
			phone: '+1 206 555 0100',
			address: '1 Main St',
			website: 'https://acme.example',
			timezone: 'America/Los_Angeles',
		});
	});

	it('rejects a duplicate email with 409', async () => {
		const payload = signupPayload();
		await app.inject({ method: 'POST', url: '/v1/auth/signup', payload });

		const second = await app.inject({
			method: 'POST',
			url: '/v1/auth/signup',
			payload: { ...signupPayload(), email: payload.email },
		});

		expect(second.statusCode).toBe(409);
	});

	it('gives same-named businesses distinct slugs', async () => {
		const first = await signupOwner(app, { businessName: 'Cascade Plumbing' });
		const second = await signupOwner(app, { businessName: 'Cascade Plumbing' });

		expect(first.account.slug).toBe('cascade-plumbing');
		expect(second.account.slug).toBe('cascade-plumbing-2');
	});

	it('falls back to the "account" slug when the name has no slug characters', async () => {
		const { account } = await signupOwner(app, { businessName: '🎉' });
		expect(account.slug).toBe('account');
	});

	it('rejects an invalid email with 400', async () => {
		const response = await app.inject({
			method: 'POST',
			url: '/v1/auth/signup',
			payload: { ...signupPayload(), email: 'not-an-email' },
		});

		expect(response.statusCode).toBe(400);
	});

	it('rejects a short password with 400', async () => {
		const response = await app.inject({
			method: 'POST',
			url: '/v1/auth/signup',
			payload: { ...signupPayload(), password: 'short' },
		});

		expect(response.statusCode).toBe(400);
	});

	it('rejects signup without business information with 400', async () => {
		const { email, password, name } = signupPayload();
		const response = await app.inject({
			method: 'POST',
			url: '/v1/auth/signup',
			payload: { email, password, name },
		});

		expect(response.statusCode).toBe(400);
	});

	it('retries slug generation when an account slug collides under concurrency', async () => {
		// Simulate a duplicate-slug race: the first signup attempt loses the unique
		// index and the route must regenerate the slug and succeed on retry.
		const repos = createInMemoryRepositories();
		let calls = 0;
		const onboarding = {
			signup: (input: Parameters<typeof repos.onboarding.signup>[0]) => {
				calls += 1;
				if (calls === 1) {
					throw new ConflictError('slug', 'An account with this slug already exists');
				}
				return repos.onboarding.signup(input);
			},
			acceptInvite: repos.onboarding.acceptInvite.bind(repos.onboarding),
		};
		const raced = await buildTestApp({
			users: repos.users,
			accounts: repos.accounts,
			memberships: repos.memberships,
			invites: repos.invites,
			onboarding,
		});

		const response = await raced.inject({
			method: 'POST',
			url: '/v1/auth/signup',
			payload: { ...signupPayload(), business: { businessName: 'Race Co' } },
		});

		expect(response.statusCode).toBe(201);
		expect(calls).toBe(2);
		expect(response.json().account.slug).toBe('race-co');
		await raced.close();
	});
});

describe('login', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		app = await buildTestApp();
	});

	afterEach(async () => {
		await app.close();
	});

	it('logs in and returns the account and role', async () => {
		const { credentials, account } = await signupOwner(app);

		const response = await app.inject({
			method: 'POST',
			url: '/v1/auth/login',
			payload: { email: credentials.email, password: credentials.password },
		});

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.token).toBeTypeOf('string');
		expect(body.role).toBe('owner');
		expect(body.account.id).toBe(account.id);
	});

	it('rejects a wrong password with 401', async () => {
		const { credentials } = await signupOwner(app);

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

	it('rejects a user that has no membership with 401', async () => {
		const { app: rawApp, repos } = await buildTestAppWithRepos();
		const passwordHash = await hashPassword('supersecret123');
		await repos.users.create({ email: 'lonely@example.com', name: 'Lonely', passwordHash });

		const response = await rawApp.inject({
			method: 'POST',
			url: '/v1/auth/login',
			payload: { email: 'lonely@example.com', password: 'supersecret123' },
		});

		expect(response.statusCode).toBe(401);
		await rawApp.close();
	});
});

describe('me', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		app = await buildTestApp();
	});

	afterEach(async () => {
		await app.close();
	});

	it('returns the current user, account, and role', async () => {
		const { credentials, token, account } = await signupOwner(app);

		const response = await app.inject({
			method: 'GET',
			url: '/v1/auth/me',
			headers: authHeader(token),
		});

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.user.email).toBe(credentials.email);
		expect(body.account.id).toBe(account.id);
		expect(body.role).toBe('owner');
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

describe('accept-invite', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		app = await buildTestApp();
	});

	afterEach(async () => {
		await app.close();
	});

	async function invite(token: string, role: 'manager' | 'team_member', email: string) {
		return app.inject({
			method: 'POST',
			url: '/v1/members/invites',
			headers: authHeader(token),
			payload: { email, name: 'Invitee', role },
		});
	}

	it('lets an invitee join the account, then log in', async () => {
		const owner = await signupOwner(app);
		const inviteRes = await invite(owner.token, 'team_member', 'newhire@example.com');
		const inviteToken = inviteRes.json().token;

		const accept = await app.inject({
			method: 'POST',
			url: '/v1/auth/accept-invite',
			payload: { token: inviteToken, password: 'brandnewpass1' },
		});

		expect(accept.statusCode).toBe(201);
		const body = accept.json();
		expect(body.role).toBe('team_member');
		expect(body.account.id).toBe(owner.account.id);
		expect(body.user.email).toBe('newhire@example.com');

		const login = await app.inject({
			method: 'POST',
			url: '/v1/auth/login',
			payload: { email: 'newhire@example.com', password: 'brandnewpass1' },
		});
		expect(login.statusCode).toBe(200);
		expect(login.json().role).toBe('team_member');
	});

	it('rejects an unknown invite token with 401', async () => {
		const response = await app.inject({
			method: 'POST',
			url: '/v1/auth/accept-invite',
			payload: { token: 'nope', password: 'supersecret123' },
		});
		expect(response.statusCode).toBe(401);
	});

	it('rejects accepting an already-accepted invite with 401', async () => {
		const owner = await signupOwner(app);
		const inviteToken = (await invite(owner.token, 'team_member', 'twice@example.com')).json()
			.token;
		await app.inject({
			method: 'POST',
			url: '/v1/auth/accept-invite',
			payload: { token: inviteToken, password: 'brandnewpass1' },
		});

		const second = await app.inject({
			method: 'POST',
			url: '/v1/auth/accept-invite',
			payload: { token: inviteToken, password: 'brandnewpass1' },
		});
		expect(second.statusCode).toBe(401);
	});

	it('returns 409 if the email was claimed before the invite was accepted', async () => {
		const { app: rawApp, repos } = await buildTestAppWithRepos();
		const owner = await signupOwner(rawApp);
		await repos.invites.create({
			accountId: owner.account.id as AccountId,
			email: 'taken@example.com',
			name: 'Taken',
			role: 'team_member',
			token: 'preseeded-token',
			invitedBy: owner.user.id as UserId,
		});
		// Someone signs up with that email before the invite is accepted.
		await signupOwner(rawApp, { email: 'taken@example.com' });

		const response = await rawApp.inject({
			method: 'POST',
			url: '/v1/auth/accept-invite',
			payload: { token: 'preseeded-token', password: 'supersecret123' },
		});

		expect(response.statusCode).toBe(409);
		await rawApp.close();
	});
});

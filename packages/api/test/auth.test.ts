import type { AccountId, UserId } from '@rivus/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConflictError } from '../src/repositories/errors';
import { createInMemoryRepositories } from '../src/repositories/memory';
import { hashSecret } from '../src/services/hash';
import { MAX_VERIFICATION_ATTEMPTS } from '../src/services/verification';
import {
	authHeader,
	buildTestApp,
	buildTestAppWithRepos,
	fakeSignup,
	latestCodeFor,
	RecordingMailer,
	signupOwner,
} from './helpers';

function signupBody(over: Partial<{ email: string; businessName: string }> = {}) {
	const base = fakeSignup();
	return {
		email: over.email ?? base.email,
		name: base.name,
		business: { businessName: over.businessName ?? base.businessName },
	};
}

function requestSignup(app: FastifyInstance, payload: Record<string, unknown>) {
	return app.inject({ method: 'POST', url: '/v1/auth/signup', payload });
}

function verifyCode(app: FastifyInstance, email: string, code: string) {
	return app.inject({ method: 'POST', url: '/v1/auth/verify', payload: { email, code } });
}

/** A 6-digit code guaranteed to differ from `code`. */
function wrongCode(code: string): string {
	return code === '000000' ? '111111' : '000000';
}

describe('signup', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		app = await buildTestApp();
	});

	afterEach(async () => {
		await app.close();
	});

	it('emails a one-time code and does not create a session yet', async () => {
		const payload = signupBody({ email: 'owner@example.com' });
		const response = await requestSignup(app, payload);

		expect(response.statusCode).toBe(202);
		expect(response.json()).toEqual({ status: 'code_sent', email: 'owner@example.com' });
		// A code was emailed, but nothing was created until it's verified.
		expect(latestCodeFor(app, 'owner@example.com')).toMatch(/^\d{6}$/);
	});

	it('verifying the code creates the account + owner and returns a session', async () => {
		const payload = signupBody({ email: 'owner@example.com', businessName: 'Cascade Plumbing' });
		await requestSignup(app, payload);
		const response = await verifyCode(app, 'owner@example.com', latestCodeFor(app, payload.email));

		expect(response.statusCode).toBe(201);
		const body = response.json();
		expect(body.token).toBeTypeOf('string');
		expect(body.role).toBe('owner');
		expect(body.user.email).toBe('owner@example.com');
		expect(body.user).not.toHaveProperty('passwordHash');
		expect(body.account).toMatchObject({
			name: 'Cascade Plumbing',
			slug: 'cascade-plumbing',
			timezone: 'UTC',
		});
	});

	it('carries through the optional business fields', async () => {
		const email = 'biz@example.com';
		await requestSignup(app, {
			...signupBody({ email }),
			business: {
				businessName: 'Acme',
				phone: '+1 206 555 0100',
				address: '1 Main St',
				website: 'https://acme.example',
				timezone: 'America/Los_Angeles',
			},
		});
		const response = await verifyCode(app, email, latestCodeFor(app, email));

		expect(response.statusCode).toBe(201);
		expect(response.json().account).toMatchObject({
			phone: '+1 206 555 0100',
			address: '1 Main St',
			website: 'https://acme.example',
			timezone: 'America/Los_Angeles',
		});
	});

	it('rejects a duplicate email with 409 before sending a code', async () => {
		await signupOwner(app, { email: 'dupe@example.com' });

		const second = await requestSignup(app, signupBody({ email: 'dupe@example.com' }));
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
		const response = await requestSignup(app, { ...signupBody(), email: 'not-an-email' });
		expect(response.statusCode).toBe(400);
	});

	it('rejects signup without business information with 400', async () => {
		const { email, name } = signupBody();
		const response = await requestSignup(app, { email, name });
		expect(response.statusCode).toBe(400);
	});

	it('still returns 202 when code delivery fails (delivery is best-effort)', async () => {
		class FailingCodeMailer extends RecordingMailer {
			override async sendVerificationCode(): Promise<void> {
				throw new Error('resend is down');
			}
		}
		const failApp = await buildTestApp({ mailer: new FailingCodeMailer() });
		const response = await requestSignup(failApp, signupBody({ email: 'nodeliver@example.com' }));
		expect(response.statusCode).toBe(202);
		await failApp.close();
	});

	it('retries slug generation when an account slug collides under concurrency', async () => {
		// Simulate a duplicate-slug race: the first account-creation attempt loses the
		// unique index and the verify step must regenerate the slug and succeed.
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

		const email = 'race@example.com';
		await requestSignup(raced, { ...signupBody({ email }), business: { businessName: 'Race Co' } });
		const response = await verifyCode(raced, email, latestCodeFor(raced, email));

		expect(response.statusCode).toBe(201);
		expect(calls).toBe(2);
		expect(response.json().account.slug).toBe('race-co');
		await raced.close();
	});
});

describe('verify', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		app = await buildTestApp();
	});

	afterEach(async () => {
		await app.close();
	});

	it('rejects a code for an email with no outstanding code (401)', async () => {
		const response = await verifyCode(app, 'ghost@example.com', '123456');
		expect(response.statusCode).toBe(401);
	});

	it('rejects a wrong code with 401', async () => {
		const email = 'owner@example.com';
		await requestSignup(app, signupBody({ email }));
		const code = latestCodeFor(app, email);

		const response = await verifyCode(app, email, wrongCode(code));
		expect(response.statusCode).toBe(401);
	});

	it('locks the code with 429 after too many wrong attempts', async () => {
		const email = 'owner@example.com';
		await requestSignup(app, signupBody({ email }));
		const code = latestCodeFor(app, email);

		for (let i = 0; i < MAX_VERIFICATION_ATTEMPTS; i++) {
			const attempt = await verifyCode(app, email, wrongCode(code));
			expect(attempt.statusCode).toBe(401);
		}
		// Budget spent: even the *correct* code is now locked out.
		const locked = await verifyCode(app, email, code);
		expect(locked.statusCode).toBe(429);
	});

	it('does not let concurrent requests bypass the attempt limit', async () => {
		const email = 'owner@example.com';
		await requestSignup(app, signupBody({ email }));
		const code = latestCodeFor(app, email);
		const wrong = wrongCode(code);

		// Fire many wrong-code verifications at once. Without reserving each attempt
		// (an atomic increment) before the slow scrypt compare, they'd all read
		// attempts=0 and slip past the limit — brute-forcing the code.
		const responses = await Promise.all(
			Array.from({ length: 20 }, () => verifyCode(app, email, wrong)),
		);
		const statuses = responses.map((response) => response.statusCode);
		expect(statuses.filter((status) => status === 401).length).toBeLessThanOrEqual(
			MAX_VERIFICATION_ATTEMPTS,
		);
		expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);

		// The code is now locked, even for the correct value.
		expect((await verifyCode(app, email, code)).statusCode).toBe(429);
	});

	it('rejects an expired code with 401', async () => {
		const { app: rawApp, repos } = await buildTestAppWithRepos();
		await repos.verificationCodes.upsert({
			email: 'stale@example.com',
			purpose: 'login',
			codeHash: await hashSecret('123456'),
			expiresAt: new Date(Date.now() - 1000).toISOString(),
		});

		const response = await verifyCode(rawApp, 'stale@example.com', '123456');
		expect(response.statusCode).toBe(401);
		await rawApp.close();
	});

	it('cannot replay a code after it succeeds', async () => {
		const email = 'owner@example.com';
		await requestSignup(app, signupBody({ email }));
		const code = latestCodeFor(app, email);

		expect((await verifyCode(app, email, code)).statusCode).toBe(201);
		// The code was consumed; presenting it again is unauthorized.
		expect((await verifyCode(app, email, code)).statusCode).toBe(401);
	});

	it('consumes a single-use code exactly once under concurrent verification', async () => {
		const email = 'owner@example.com';
		await requestSignup(app, signupBody({ email }));
		const code = latestCodeFor(app, email);

		// Two requests race with the same valid code; only one may mint a session.
		const [a, b] = await Promise.all([verifyCode(app, email, code), verifyCode(app, email, code)]);
		expect([a.statusCode, b.statusCode].sort()).toEqual([201, 401]);
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

	it('emails a code and verifying it returns the account and role', async () => {
		const { credentials, account } = await signupOwner(app);

		const requested = await app.inject({
			method: 'POST',
			url: '/v1/auth/login',
			payload: { email: credentials.email },
		});
		expect(requested.statusCode).toBe(202);

		const response = await verifyCode(
			app,
			credentials.email,
			latestCodeFor(app, credentials.email),
		);
		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.token).toBeTypeOf('string');
		expect(body.role).toBe('owner');
		expect(body.account.id).toBe(account.id);
	});

	it('returns 202 for an unknown email but sends no code (no enumeration)', async () => {
		const response = await app.inject({
			method: 'POST',
			url: '/v1/auth/login',
			payload: { email: 'ghost@example.com' },
		});

		expect(response.statusCode).toBe(202);
		expect(() => latestCodeFor(app, 'ghost@example.com')).toThrow();
	});

	it('rejects a user that has no membership with 401 on verify', async () => {
		const { app: rawApp, repos } = await buildTestAppWithRepos();
		await repos.users.create({ email: 'lonely@example.com', name: 'Lonely' });

		await rawApp.inject({
			method: 'POST',
			url: '/v1/auth/login',
			payload: { email: 'lonely@example.com' },
		});
		const response = await verifyCode(
			rawApp,
			'lonely@example.com',
			latestCodeFor(rawApp, 'lonely@example.com'),
		);

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

	function invite(token: string, role: 'manager' | 'team_member', email: string) {
		return app.inject({
			method: 'POST',
			url: '/v1/members/invites',
			headers: authHeader(token),
			payload: { email, name: 'Invitee', role },
		});
	}

	it('lets an invitee join the account, then sign in with a code', async () => {
		const owner = await signupOwner(app);
		const inviteToken = (await invite(owner.token, 'team_member', 'newhire@example.com')).json()
			.token;

		const accept = await app.inject({
			method: 'POST',
			url: '/v1/auth/accept-invite',
			payload: { token: inviteToken },
		});

		expect(accept.statusCode).toBe(201);
		const body = accept.json();
		expect(body.role).toBe('team_member');
		expect(body.account.id).toBe(owner.account.id);
		expect(body.user.email).toBe('newhire@example.com');

		await app.inject({
			method: 'POST',
			url: '/v1/auth/login',
			payload: { email: 'newhire@example.com' },
		});
		const login = await verifyCode(
			app,
			'newhire@example.com',
			latestCodeFor(app, 'newhire@example.com'),
		);
		expect(login.statusCode).toBe(200);
		expect(login.json().role).toBe('team_member');
	});

	it('rejects an unknown invite token with 401', async () => {
		const response = await app.inject({
			method: 'POST',
			url: '/v1/auth/accept-invite',
			payload: { token: 'nope' },
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
			payload: { token: inviteToken },
		});

		const second = await app.inject({
			method: 'POST',
			url: '/v1/auth/accept-invite',
			payload: { token: inviteToken },
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
			payload: { token: 'preseeded-token' },
		});

		expect(response.statusCode).toBe(409);
		await rawApp.close();
	});
});

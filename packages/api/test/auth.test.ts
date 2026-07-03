import { type AccountId, gravatarUrl, type UserId } from '@rivus/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { SESSION_COOKIE } from '../src/plugins/auth';
import { ConflictError } from '../src/repositories/errors';
import { createInMemoryRepositories } from '../src/repositories/memory';
import { hashSecret } from '../src/services/hash';
import { MAX_VERIFICATION_ATTEMPTS } from '../src/services/verification';
import {
	addMember,
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

	it('rejects an invalid email with 400 and a friendly top-level message', async () => {
		const response = await requestSignup(app, { ...signupBody(), email: 'not-an-email' });
		expect(response.statusCode).toBe(400);
		// Not the generic "Request validation failed" — the field's plain-language message.
		expect(response.json().message).toBe('Enter a valid email address.');
		expect(response.json().details).toHaveLength(1);
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
		// The session carries the agent-email domain so the app can show the
		// account's inbound address (`<slug>@<domain>`) without hardcoding it.
		expect(body.agentEmailDomain).toBe('riv.us');
	});

	it('defaults the user avatar to their Gravatar when no custom image is set', async () => {
		const { credentials, token } = await signupOwner(app);

		const response = await app.inject({
			method: 'GET',
			url: '/v1/auth/me',
			headers: authHeader(token),
		});

		expect(response.json().user.avatarUrl).toBe(gravatarUrl(credentials.email));
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

	it('exposes the new profile fields (phone, pendingEmail) defaulting to empty', async () => {
		const { token } = await signupOwner(app);
		const response = await app.inject({
			method: 'GET',
			url: '/v1/auth/me',
			headers: authHeader(token),
		});
		expect(response.json().user).toMatchObject({ phone: '', pendingEmail: '' });
	});
});

describe('profile (update + email re-verify)', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		app = await buildTestApp();
	});

	afterEach(async () => {
		await app.close();
	});

	function updateProfile(token: string, payload: Record<string, unknown>) {
		return app.inject({ method: 'PATCH', url: '/v1/auth/me', headers: authHeader(token), payload });
	}

	function verifyEmailChange(token: string, code: string) {
		return app.inject({
			method: 'POST',
			url: '/v1/auth/me/email/verify',
			headers: authHeader(token),
			payload: { code },
		});
	}

	function getMe(token: string) {
		return app.inject({ method: 'GET', url: '/v1/auth/me', headers: authHeader(token) });
	}

	it('requires authentication', async () => {
		const response = await app.inject({
			method: 'PATCH',
			url: '/v1/auth/me',
			payload: { name: 'Nobody' },
		});
		expect(response.statusCode).toBe(401);
	});

	it('updates name and phone and reflects them on /me', async () => {
		const owner = await signupOwner(app);
		const response = await updateProfile(owner.token, {
			name: 'Marcus Thompson',
			phone: '+1 206 555 0100',
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			name: 'Marcus Thompson',
			phone: '+1 206 555 0100',
			pendingEmail: '',
		});
		expect((await getMe(owner.token)).json().user).toMatchObject({
			name: 'Marcus Thompson',
			phone: '+1 206 555 0100',
		});
	});

	it('applies a partial update without blanking untouched fields', async () => {
		const owner = await signupOwner(app);
		await updateProfile(owner.token, { phone: '+1 555 0001' });
		const response = await updateProfile(owner.token, { name: 'Renamed Person' });

		expect(response.statusCode).toBe(200);
		// The earlier phone survives a name-only update.
		expect(response.json()).toMatchObject({ name: 'Renamed Person', phone: '+1 555 0001' });
	});

	it('rejects an empty update (400)', async () => {
		const owner = await signupOwner(app);
		expect((await updateProfile(owner.token, {})).statusCode).toBe(400);
	});

	it('lets a non-owner member update their own profile', async () => {
		const owner = await signupOwner(app);
		const member = await addMember(app, owner.token, 'member', 'tm@example.com');
		const response = await updateProfile(member.token, { name: 'Team Member' });
		expect(response.statusCode).toBe(200);
		expect(response.json().name).toBe('Team Member');
	});

	it('submitting your current email is a no-op (no code sent)', async () => {
		const owner = await signupOwner(app, { email: 'owner@example.com' });
		const mailer = app.deps.mailer as RecordingMailer;
		const sentBefore = mailer.codes.length;

		const response = await updateProfile(owner.token, { email: 'owner@example.com' });
		expect(response.statusCode).toBe(200);
		expect(response.json().pendingEmail).toBe('');
		// No verification code was emailed for a same-address "change".
		expect(mailer.codes.length).toBe(sentBefore);
	});

	it('does not change the email immediately — it stages it and emails a code', async () => {
		const owner = await signupOwner(app, { email: 'owner@example.com' });
		const response = await updateProfile(owner.token, { email: 'new@example.com' });

		expect(response.statusCode).toBe(200);
		// Live email is unchanged; the new address is staged as pending.
		expect(response.json()).toMatchObject({
			email: 'owner@example.com',
			pendingEmail: 'new@example.com',
		});
		// The code goes to the NEW address, with the email-change purpose.
		expect(latestCodeFor(app, 'new@example.com')).toMatch(/^\d{6}$/);
		const mailer = app.deps.mailer as RecordingMailer;
		expect(mailer.codes.at(-1)).toMatchObject({ to: 'new@example.com', purpose: 'email_change' });
		// /me still reports the old email plus the pending one.
		expect((await getMe(owner.token)).json().user).toMatchObject({
			email: 'owner@example.com',
			pendingEmail: 'new@example.com',
		});
	});

	it('confirms the change with the code, swaps the email, and clears pendingEmail', async () => {
		const owner = await signupOwner(app, { email: 'owner@example.com' });
		await updateProfile(owner.token, { email: 'new@example.com' });
		const response = await verifyEmailChange(owner.token, latestCodeFor(app, 'new@example.com'));

		expect(response.statusCode).toBe(200);
		const body = response.json();
		// A fresh session is returned so the token/cookie carry the new email.
		expect(body.token).toBeTypeOf('string');
		expect(body.user).toMatchObject({ email: 'new@example.com', pendingEmail: '' });
		expect(body.role).toBe('owner');
		expect((await getMe(body.token)).json().user.email).toBe('new@example.com');
	});

	it('moves the address so the old email no longer resolves and the new one does', async () => {
		const owner = await signupOwner(app, { email: 'old@example.com' });
		await updateProfile(owner.token, { email: 'fresh@example.com' });
		await verifyEmailChange(owner.token, latestCodeFor(app, 'fresh@example.com'));

		expect(await app.deps.users.findByEmail('old@example.com')).toBeNull();
		expect((await app.deps.users.findByEmail('fresh@example.com'))?.id).toBe(owner.user.id);
	});

	it('rejects a wrong confirmation code (401) and locks after too many attempts (429)', async () => {
		const owner = await signupOwner(app, { email: 'owner@example.com' });
		await updateProfile(owner.token, { email: 'new@example.com' });
		const code = latestCodeFor(app, 'new@example.com');

		for (let i = 0; i < MAX_VERIFICATION_ATTEMPTS; i++) {
			expect((await verifyEmailChange(owner.token, wrongCode(code))).statusCode).toBe(401);
		}
		// Budget spent: even the correct code is now locked out.
		expect((await verifyEmailChange(owner.token, code)).statusCode).toBe(429);
	});

	it('returns 400 when confirming with no pending change', async () => {
		const owner = await signupOwner(app);
		expect((await verifyEmailChange(owner.token, '123456')).statusCode).toBe(400);
	});

	it('rejects confirmation when the code was consumed or never arrived (401)', async () => {
		const owner = await signupOwner(app, { email: 'owner@example.com' });
		await updateProfile(owner.token, { email: 'new@example.com' });
		// Drop the outstanding code, then try to confirm: the pending change remains but
		// there's no code to match.
		await app.deps.verificationCodes.delete('new@example.com');
		expect((await verifyEmailChange(owner.token, '123456')).statusCode).toBe(401);
	});

	it('refuses to start a change to an email another user already owns (409)', async () => {
		const owner = await signupOwner(app, { email: 'owner@example.com' });
		await signupOwner(app, { email: 'taken@example.com' });
		expect((await updateProfile(owner.token, { email: 'taken@example.com' })).statusCode).toBe(409);
	});

	it('refuses to move a regular account onto the Rivus staff domain (403, no self-elevation)', async () => {
		const owner = await signupOwner(app, { email: 'owner@example.com' });
		const response = await updateProfile(owner.token, { email: 'sneaky@rivus.ai' });
		expect(response.statusCode).toBe(403);
		// Nothing was staged and no code was emailed to the staff address.
		expect((await getMe(owner.token)).json().user.pendingEmail).toBe('');
		expect(() => latestCodeFor(app, 'sneaky@rivus.ai')).toThrow();
	});

	it('refuses to change a staff member off the staff domain via the profile (403)', async () => {
		// A staff account (its email is on the staff domain) can't self-service an email
		// change here — that would strand a stale staff claim on its other sessions.
		const staff = await signupOwner(app, { email: 'ops@rivus.ai' });
		const response = await updateProfile(staff.token, { email: 'ops-personal@example.com' });
		expect(response.statusCode).toBe(403);
	});

	it('does not let the public /verify endpoint consume or burn an email-change code', async () => {
		const owner = await signupOwner(app, { email: 'owner@example.com' });
		await updateProfile(owner.token, { email: 'new@example.com' });
		const code = latestCodeFor(app, 'new@example.com');

		// The generic passwordless sign-in must not touch an email-change code, even
		// with the correct value: it's rejected before the attempt counter or delete.
		const viaVerify = await app.inject({
			method: 'POST',
			url: '/v1/auth/verify',
			payload: { email: 'new@example.com', code },
		});
		expect(viaVerify.statusCode).toBe(401);

		// So the authenticated confirm still succeeds with that same, un-burned code.
		const confirm = await verifyEmailChange(owner.token, code);
		expect(confirm.statusCode).toBe(200);
		expect(confirm.json().user.email).toBe('new@example.com');
	});

	it('cannot replay a confirmation code after it succeeds', async () => {
		const owner = await signupOwner(app, { email: 'owner@example.com' });
		await updateProfile(owner.token, { email: 'new@example.com' });
		const code = latestCodeFor(app, 'new@example.com');
		expect((await verifyEmailChange(owner.token, code)).statusCode).toBe(200);
		// The change is done and pendingEmail cleared, so the same code now 400s.
		expect((await verifyEmailChange(owner.token, code)).statusCode).toBe(400);
	});
});

describe('profile avatar (PATCH /v1/auth/me)', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		app = await buildTestApp();
	});

	afterEach(async () => {
		await app.close();
	});

	it('sets a custom avatar image, overriding the Gravatar default', async () => {
		const { token } = await signupOwner(app);

		const response = await app.inject({
			method: 'PATCH',
			url: '/v1/auth/me',
			headers: authHeader(token),
			payload: { avatarUrl: 'https://example.com/me.jpg' },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().avatarUrl).toBe('https://example.com/me.jpg');
	});

	it('clears a custom avatar with an empty string, reverting to the Gravatar default', async () => {
		const { credentials, token } = await signupOwner(app);
		await app.inject({
			method: 'PATCH',
			url: '/v1/auth/me',
			headers: authHeader(token),
			payload: { avatarUrl: 'https://example.com/me.jpg' },
		});

		const cleared = await app.inject({
			method: 'PATCH',
			url: '/v1/auth/me',
			headers: authHeader(token),
			payload: { avatarUrl: '' },
		});

		expect(cleared.statusCode).toBe(200);
		expect(cleared.json().avatarUrl).toBe(gravatarUrl(credentials.email));
	});

	it('persists the change — a later /me reflects the new avatar', async () => {
		const { token } = await signupOwner(app);
		await app.inject({
			method: 'PATCH',
			url: '/v1/auth/me',
			headers: authHeader(token),
			payload: { avatarUrl: 'https://example.com/me.jpg' },
		});

		const me = await app.inject({
			method: 'GET',
			url: '/v1/auth/me',
			headers: authHeader(token),
		});

		expect(me.json().user.avatarUrl).toBe('https://example.com/me.jpg');
	});

	it('rejects a malformed image URL (400)', async () => {
		const { token } = await signupOwner(app);

		const response = await app.inject({
			method: 'PATCH',
			url: '/v1/auth/me',
			headers: authHeader(token),
			payload: { avatarUrl: 'not a url' },
		});

		expect(response.statusCode).toBe(400);
	});

	it('accepts a photo uploaded from the app, encoded as a data: URI', async () => {
		const { token } = await signupOwner(app);
		const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wA=';

		const response = await app.inject({
			method: 'PATCH',
			url: '/v1/auth/me',
			headers: authHeader(token),
			payload: { avatarUrl: dataUrl },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().avatarUrl).toBe(dataUrl);
	});

	it('rejects a non-http(s) scheme even though it looks URL-shaped (400)', async () => {
		const { token } = await signupOwner(app);

		const response = await app.inject({
			method: 'PATCH',
			url: '/v1/auth/me',
			headers: authHeader(token),
			payload: { avatarUrl: 'javascript:alert(1)' },
		});

		expect(response.statusCode).toBe(400);
	});

	it('lets a non-owner member edit their own avatar (not owner-gated)', async () => {
		const owner = await signupOwner(app);
		const member = await addMember(app, owner.token, 'member', 'teammate@example.com');

		const response = await app.inject({
			method: 'PATCH',
			url: '/v1/auth/me',
			headers: authHeader(member.token),
			payload: { avatarUrl: 'https://example.com/member.jpg' },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().avatarUrl).toBe('https://example.com/member.jpg');
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

	function invite(token: string, role: 'manager' | 'member', email: string) {
		return app.inject({
			method: 'POST',
			url: '/v1/members/invites',
			headers: authHeader(token),
			payload: { email, name: 'Invitee', role },
		});
	}

	it('lets an invitee join the account, then sign in with a code', async () => {
		const owner = await signupOwner(app);
		const inviteToken = (await invite(owner.token, 'member', 'newhire@example.com')).json().token;

		const accept = await app.inject({
			method: 'POST',
			url: '/v1/auth/accept-invite',
			payload: { token: inviteToken },
		});

		expect(accept.statusCode).toBe(201);
		const body = accept.json();
		expect(body.role).toBe('member');
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
		expect(login.json().role).toBe('member');
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
		const inviteToken = (await invite(owner.token, 'member', 'twice@example.com')).json().token;
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
			role: 'member',
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

describe('session cookie', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		app = await buildTestApp();
	});

	afterEach(async () => {
		await app.close();
	});

	type Injected = Awaited<ReturnType<FastifyInstance['inject']>>;
	const cookieRe = new RegExp(`${SESSION_COOKIE}=([^;]*)`);

	function setCookieHeader(res: Injected): string {
		const header = res.headers['set-cookie'];
		return Array.isArray(header) ? header.join('\n') : String(header ?? '');
	}

	function sessionCookieValue(res: Injected): string {
		return setCookieHeader(res).match(cookieRe)?.[1] ?? '';
	}

	it('sets an HttpOnly, SameSite=Lax session cookie carrying the token on verify', async () => {
		const email = 'cookie@example.com';
		await requestSignup(app, signupBody({ email }));
		const res = await verifyCode(app, email, latestCodeFor(app, email));

		expect(res.statusCode).toBe(201);
		const header = setCookieHeader(res);
		expect(header).toContain(`${SESSION_COOKIE}=`);
		expect(header).toContain('HttpOnly');
		expect(header).toMatch(/SameSite=Lax/i);
		expect(header).toContain('Path=/');
		// The cookie carries the same JWT returned in the body (which native clients use).
		expect(sessionCookieValue(res)).toBe(res.json().token);
	});

	it('authenticates /me with only the session cookie (no Authorization header)', async () => {
		const email = 'cookie-me@example.com';
		await requestSignup(app, signupBody({ email }));
		const verified = await verifyCode(app, email, latestCodeFor(app, email));
		const token = sessionCookieValue(verified);

		const res = await app.inject({
			method: 'GET',
			url: '/v1/auth/me',
			cookies: { [SESSION_COOKIE]: token },
		});

		expect(res.statusCode).toBe(200);
		expect(res.json().user.email).toBe(email);
	});

	it('clears the session cookie on logout', async () => {
		const res = await app.inject({ method: 'POST', url: '/v1/auth/logout' });

		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({ status: 'signed_out' });
		// Cleared: the cookie is re-sent with an empty value so the browser drops it.
		expect(setCookieHeader(res)).toContain(`${SESSION_COOKIE}=`);
		expect(sessionCookieValue(res)).toBe('');
	});

	it('scopes the cookie to COOKIE_DOMAIN so subdomains (app, agent) receive it', async () => {
		// A parent-domain cookie is what lets a web user reach an authenticated agent
		// on a sibling subdomain (agent.rivus.ai) with the session set by the API.
		const scoped = await buildTestApp({
			config: loadConfig({
				NODE_ENV: 'test',
				JWT_SECRET: 'test-secret-value-1234',
				COOKIE_DOMAIN: '.rivus.ai',
			} as NodeJS.ProcessEnv),
		});
		const email = 'domain@example.com';
		await requestSignup(scoped, signupBody({ email }));
		const verified = await verifyCode(scoped, email, latestCodeFor(scoped, email));
		expect(setCookieHeader(verified)).toMatch(/Domain=\.rivus\.ai/i);

		// Logout must clear with the same Domain or the browser won't drop it.
		const out = await scoped.inject({ method: 'POST', url: '/v1/auth/logout' });
		expect(setCookieHeader(out)).toMatch(/Domain=\.rivus\.ai/i);
		await scoped.close();
	});

	it('omits the Domain attribute when COOKIE_DOMAIN is unset (host-only)', async () => {
		const email = 'hostonly@example.com';
		await requestSignup(app, signupBody({ email }));
		const verified = await verifyCode(app, email, latestCodeFor(app, email));
		expect(setCookieHeader(verified)).not.toMatch(/Domain=/i);
	});
});

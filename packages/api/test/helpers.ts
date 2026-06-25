import { faker } from '@faker-js/faker';
import type { Account, Role, User } from '@rivus/core';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createInMemoryRepositories, type InMemoryRepositories } from '../src/repositories/memory';
import type { InviteEmail, Mailer, VerificationEmail } from '../src/services/email';
import type { AppDeps } from '../src/types';

/** A mailer that records every send so tests can assert on (and read) delivered email. */
export class RecordingMailer implements Mailer {
	readonly invites: InviteEmail[] = [];
	readonly codes: VerificationEmail[] = [];

	async sendInviteEmail(email: InviteEmail): Promise<void> {
		this.invites.push(email);
	}

	async sendVerificationCode(email: VerificationEmail): Promise<void> {
		this.codes.push(email);
	}
}

const TEST_CONFIG = {
	NODE_ENV: 'test',
	JWT_SECRET: 'test-secret-value-1234',
} as NodeJS.ProcessEnv;

export async function buildTestApp(overrides: Partial<AppDeps> = {}): Promise<FastifyInstance> {
	const { users, accounts, memberships, invites, onboarding, items, verificationCodes } =
		createInMemoryRepositories();
	const app = buildApp({
		config: loadConfig(TEST_CONFIG),
		users,
		accounts,
		memberships,
		invites,
		onboarding,
		items,
		verificationCodes,
		// A recording mailer by default so helpers can read back the emailed code.
		mailer: new RecordingMailer(),
		ping: async () => ({ ready: true }),
		...overrides,
	});
	await app.ready();
	return app;
}

/**
 * Build an app whose repositories are exposed, so a test can seed data directly
 * (e.g. a user with no membership) to exercise edge cases.
 */
export async function buildTestAppWithRepos(): Promise<{
	app: FastifyInstance;
	repos: InMemoryRepositories;
}> {
	const repos = createInMemoryRepositories();
	const { users, accounts, memberships, invites, onboarding, items, verificationCodes } = repos;
	const app = buildApp({
		config: loadConfig(TEST_CONFIG),
		users,
		accounts,
		memberships,
		invites,
		onboarding,
		items,
		verificationCodes,
		mailer: new RecordingMailer(),
		ping: async () => ({ ready: true }),
	});
	await app.ready();
	return { app, repos };
}

/** Read the most recent one-time code emailed to `email` (throws if none). */
export function latestCodeFor(app: FastifyInstance, email: string): string {
	const mailer = app.deps.mailer;
	if (!(mailer instanceof RecordingMailer)) {
		throw new Error('latestCodeFor requires the app to use a RecordingMailer');
	}
	const normalized = email.trim().toLowerCase();
	const last = mailer.codes.filter((entry) => entry.to === normalized).at(-1);
	if (!last) {
		throw new Error(`no verification code was emailed to ${normalized}`);
	}
	return last.code;
}

export interface SignupCredentials {
	email: string;
	name: string;
	businessName: string;
}

export function fakeSignup(overrides: Partial<SignupCredentials> = {}): SignupCredentials {
	return {
		email: faker.internet.email().toLowerCase(),
		name: faker.person.fullName(),
		businessName: faker.company.name(),
		...overrides,
	};
}

export interface SignedUpUser {
	credentials: SignupCredentials;
	token: string;
	user: User;
	account: Account;
	role: Role;
}

/** Run the passwordless signup → verify flow and return the resulting session. */
export async function signupOwner(
	app: FastifyInstance,
	overrides: Partial<SignupCredentials> = {},
): Promise<SignedUpUser> {
	const credentials = fakeSignup(overrides);
	await app.inject({
		method: 'POST',
		url: '/v1/auth/signup',
		payload: {
			email: credentials.email,
			name: credentials.name,
			business: { businessName: credentials.businessName },
		},
	});
	const verified = await app.inject({
		method: 'POST',
		url: '/v1/auth/verify',
		payload: { email: credentials.email, code: latestCodeFor(app, credentials.email) },
	});
	const body = verified.json<{ token: string; user: User; account: Account; role: Role }>();
	return {
		credentials,
		token: body.token,
		user: body.user,
		account: body.account,
		role: body.role,
	};
}

export function authHeader(token: string): { authorization: string } {
	return { authorization: `Bearer ${token}` };
}

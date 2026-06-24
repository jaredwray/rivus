import { faker } from '@faker-js/faker';
import type { Account, Role, User } from '@rivus/core';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createInMemoryRepositories, type InMemoryRepositories } from '../src/repositories/memory';
import { type InviteEmail, type Mailer, NoopMailer } from '../src/services/email';
import type { AppDeps } from '../src/types';

/** A mailer that records every send so tests can assert on delivered email. */
export class RecordingMailer implements Mailer {
	readonly invites: InviteEmail[] = [];

	async sendInviteEmail(email: InviteEmail): Promise<void> {
		this.invites.push(email);
	}
}

export async function buildTestApp(overrides: Partial<AppDeps> = {}): Promise<FastifyInstance> {
	const config = loadConfig({
		NODE_ENV: 'test',
		JWT_SECRET: 'test-secret-value-1234',
	} as NodeJS.ProcessEnv);
	const { users, accounts, memberships, invites, onboarding, items } = createInMemoryRepositories();
	const app = buildApp({
		config,
		users,
		accounts,
		memberships,
		invites,
		onboarding,
		items,
		mailer: new NoopMailer(),
		ping: async () => true,
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
	const config = loadConfig({
		NODE_ENV: 'test',
		JWT_SECRET: 'test-secret-value-1234',
	} as NodeJS.ProcessEnv);
	const { users, accounts, memberships, invites, onboarding, items } = repos;
	const app = buildApp({
		config,
		users,
		accounts,
		memberships,
		invites,
		onboarding,
		items,
		mailer: new NoopMailer(),
		ping: async () => true,
	});
	await app.ready();
	return { app, repos };
}

export interface SignupCredentials {
	email: string;
	password: string;
	name: string;
	businessName: string;
}

export function fakeSignup(overrides: Partial<SignupCredentials> = {}): SignupCredentials {
	return {
		email: faker.internet.email().toLowerCase(),
		password: 'supersecret123',
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

/** Sign up a fresh owner + account and return the session. */
export async function signupOwner(
	app: FastifyInstance,
	overrides: Partial<SignupCredentials> = {},
): Promise<SignedUpUser> {
	const credentials = fakeSignup(overrides);
	const response = await app.inject({
		method: 'POST',
		url: '/v1/auth/signup',
		payload: {
			email: credentials.email,
			password: credentials.password,
			name: credentials.name,
			business: { businessName: credentials.businessName },
		},
	});
	const body = response.json<{ token: string; user: User; account: Account; role: Role }>();
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

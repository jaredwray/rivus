import { faker } from '@faker-js/faker';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { InMemoryItemRepository, InMemoryUserRepository } from '../src/repositories/memory';

export async function buildTestApp(): Promise<FastifyInstance> {
	const config = loadConfig({
		NODE_ENV: 'test',
		JWT_SECRET: 'test-secret-value-1234',
	} as NodeJS.ProcessEnv);
	const app = buildApp({
		config,
		users: new InMemoryUserRepository(),
		items: new InMemoryItemRepository(),
	});
	await app.ready();
	return app;
}

export interface Credentials {
	email: string;
	password: string;
	name: string;
}

export function fakeCredentials(overrides: Partial<Credentials> = {}): Credentials {
	return {
		email: faker.internet.email().toLowerCase(),
		password: 'supersecret123',
		name: faker.person.fullName(),
		...overrides,
	};
}

/** Register a fresh user and return its bearer token. */
export async function registerUser(
	app: FastifyInstance,
	overrides: Partial<Credentials> = {},
): Promise<{ credentials: Credentials; token: string }> {
	const credentials = fakeCredentials(overrides);
	const response = await app.inject({
		method: 'POST',
		url: '/v1/auth/register',
		payload: credentials,
	});
	return { credentials, token: response.json<{ token: string }>().token };
}

export function authHeader(token: string): { authorization: string } {
	return { authorization: `Bearer ${token}` };
}

import { faker } from '@faker-js/faker';
import type { Account } from '@rivus/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { createInMemoryRepositories, type InMemoryRepositories } from '../src/repositories/memory';
import { DeterministicSeedGenerator } from '../src/seed-ai';
import { SEED_CUSTOMER_MAX, SEED_CUSTOMER_MIN, SEED_FAQ_DEFAULT } from '../src/seed-data';
import { resolveSeedCounts, seedAccountData } from '../src/services/seed';
import { authHeader, buildTestApp, signupOwner } from './helpers';

const STAFF_EMAIL = 'ops@rivus.ai';

const generator = new DeterministicSeedGenerator();

/** An account with a single owner membership, over fresh in-memory repositories. */
async function accountWithOwner(): Promise<{ repos: InMemoryRepositories; account: Account }> {
	const repos = createInMemoryRepositories();
	const { account } = await repos.onboarding.signup({
		user: { email: 'owner@acme.test', name: 'Acme Owner' },
		account: {
			name: 'Acme Co',
			slug: 'acme-co',
			phone: '',
			address: '',
			website: '',
			timezone: 'UTC',
		},
	});
	return { repos, account };
}

describe('seedAccountData', () => {
	it('seeds the requested counts and links them to the account', async () => {
		const { repos, account } = await accountWithOwner();

		const summary = await seedAccountData(
			repos,
			generator,
			account,
			{ customers: 3, faqs: 4, appointments: 5, notifications: 2, conversations: 2 },
			{ seed: 7 },
		);

		expect(summary).toEqual({
			customers: 3,
			faqs: 4,
			faqsSkipped: 0,
			appointments: 5,
			// 2 per member × 1 member.
			notifications: 2,
			conversations: 2,
			members: 1,
			generation: 'deterministic',
		});

		const customers = await repos.customers.list({ accountId: account.id, page: 1, pageSize: 100 });
		expect(customers.total).toBe(3);
		const faqs = await repos.faqs.list({ accountId: account.id, page: 1, pageSize: 100 });
		expect(faqs.total).toBe(4);
		const jobs = await repos.jobs.list({ accountId: account.id, page: 1, pageSize: 100 });
		expect(jobs.total).toBe(5);
		// Every seeded appointment is linked to one of the seeded customers.
		expect(jobs.jobs.every((job) => job.customerId !== '')).toBe(true);
		const conversations = await repos.conversations.list({
			accountId: account.id,
			page: 1,
			pageSize: 100,
		});
		expect(conversations.total).toBe(2);
	});

	it('addresses notifications to each member and leaves the newest unread', async () => {
		const { repos, account } = await accountWithOwner();
		const ownerId = (await repos.memberships.listByAccount(account.id))[0]?.userId;
		if (!ownerId) {
			throw new Error('expected an owner membership');
		}

		await seedAccountData(repos, generator, account, {
			customers: 0,
			faqs: 0,
			appointments: 0,
			notifications: 4,
			conversations: 0,
		});

		const list = await repos.notifications.list({
			accountId: account.id,
			userId: ownerId,
			page: 1,
			pageSize: 100,
			unreadOnly: false,
		});
		expect(list.total).toBe(4);
		// The older half is marked read, so the unread count is the remaining newest.
		const unread = await repos.notifications.unreadCount(account.id, ownerId);
		expect(unread).toBe(2);
	});

	it('flags the seeded billing thread for human review', async () => {
		const { repos, account } = await accountWithOwner();
		await seedAccountData(repos, generator, account, {
			customers: 3,
			faqs: 0,
			appointments: 0,
			notifications: 0,
			conversations: 5,
		});
		const needsAttention = await repos.conversations.needsAttentionCount(account.id);
		expect(needsAttention).toBe(1);
	});

	it('skips FAQs whose question already exists on a re-run', async () => {
		const { repos, account } = await accountWithOwner();
		const counts = { customers: 0, faqs: 4, appointments: 0, notifications: 0, conversations: 0 };

		const first = await seedAccountData(repos, generator, account, counts);
		expect(first.faqs).toBe(4);
		expect(first.faqsSkipped).toBe(0);

		const second = await seedAccountData(repos, generator, account, counts);
		expect(second.faqs).toBe(0);
		expect(second.faqsSkipped).toBe(4);
		// No duplicates were written.
		const faqs = await repos.faqs.list({ accountId: account.id, page: 1, pageSize: 100 });
		expect(faqs.total).toBe(4);
	});

	it('links appointments to existing customers when customers are skipped', async () => {
		const { repos, account } = await accountWithOwner();
		await seedAccountData(repos, generator, account, {
			customers: 3,
			faqs: 0,
			appointments: 0,
			notifications: 0,
			conversations: 0,
		});

		const summary = await seedAccountData(repos, generator, account, {
			customers: 0,
			faqs: 0,
			appointments: 4,
			notifications: 0,
			conversations: 0,
		});
		expect(summary.appointments).toBe(4);
		const jobs = await repos.jobs.list({ accountId: account.id, page: 1, pageSize: 100 });
		expect(jobs.jobs.every((job) => job.customerId !== '')).toBe(true);
	});

	it('skips every entity when all counts are 0', async () => {
		const { repos, account } = await accountWithOwner();
		const summary = await seedAccountData(repos, generator, account, {
			customers: 0,
			faqs: 0,
			appointments: 0,
			notifications: 0,
			conversations: 0,
		});
		expect(summary).toEqual({
			customers: 0,
			faqs: 0,
			faqsSkipped: 0,
			appointments: 0,
			notifications: 0,
			conversations: 0,
			members: 1,
			generation: 'deterministic',
		});
	});

	it('skips notifications when the account has no members', async () => {
		const repos = createInMemoryRepositories();
		const account = await repos.accounts.create({
			name: 'No Members',
			slug: 'no-members',
			phone: '',
			address: '',
			website: '',
			timezone: 'UTC',
		});
		const summary = await seedAccountData(repos, generator, account, {
			customers: 1,
			faqs: 0,
			appointments: 0,
			notifications: 3,
			conversations: 0,
		});
		expect(summary.members).toBe(0);
		expect(summary.notifications).toBe(0);
	});

	it('falls back to default counts when they are omitted', async () => {
		const { repos, account } = await accountWithOwner();
		const summary = await seedAccountData(repos, generator, account, {}, { seed: 3 });
		expect(summary.faqs).toBe(SEED_FAQ_DEFAULT);
		expect(summary.customers).toBeGreaterThanOrEqual(SEED_CUSTOMER_MIN);
		expect(summary.customers).toBeLessThanOrEqual(SEED_CUSTOMER_MAX);
	});

	it('streams progress to the log callback', async () => {
		const { repos, account } = await accountWithOwner();
		const messages: string[] = [];
		await seedAccountData(
			repos,
			generator,
			account,
			{ customers: 2, faqs: 0, appointments: 0, notifications: 0, conversations: 0 },
			{ log: (message) => messages.push(message) },
		);
		expect(messages).toContain('Customers: created 2.');
		expect(messages).toContain('FAQs: skipped (count 0).');
	});
});

describe('resolveSeedCounts', () => {
	it('keeps explicit counts and fills absent ones with in-range defaults', () => {
		faker.seed(11);
		const resolved = resolveSeedCounts({ faqs: 2, appointments: 0 });
		expect(resolved.faqs).toBe(2);
		expect(resolved.appointments).toBe(0);
		expect(resolved.customers).toBeGreaterThanOrEqual(SEED_CUSTOMER_MIN);
		expect(resolved.customers).toBeLessThanOrEqual(SEED_CUSTOMER_MAX);
		expect(Number.isInteger(resolved.notifications)).toBe(true);
		expect(Number.isInteger(resolved.conversations)).toBe(true);
	});
});

describe('POST /v1/admin/seed (development only)', () => {
	/** A dev-mode app: the only environment where the seed route is registered. */
	function buildDevApp(): Promise<FastifyInstance> {
		return buildTestApp({
			config: loadConfig({
				NODE_ENV: 'development',
				JWT_SECRET: 'test-secret-value-1234',
				LOG_LEVEL: 'silent',
			} as NodeJS.ProcessEnv),
		});
	}

	describe('when NODE_ENV is not development', () => {
		let app: FastifyInstance;

		beforeEach(async () => {
			// The default test app runs with NODE_ENV=test, so the route is never registered.
			app = await buildTestApp();
		});

		afterEach(async () => {
			await app.close();
		});

		it('does not register the route (404), even for staff', async () => {
			const staff = await signupOwner(app, { email: STAFF_EMAIL, businessName: 'Rivus HQ' });
			const response = await app.inject({
				method: 'POST',
				url: '/v1/admin/seed',
				headers: authHeader(staff.token),
				payload: {},
			});
			expect(response.statusCode).toBe(404);
		});
	});

	describe('when NODE_ENV is development', () => {
		let app: FastifyInstance;

		beforeEach(async () => {
			app = await buildDevApp();
		});

		afterEach(async () => {
			await app.close();
		});

		function seed(token: string, payload: Record<string, unknown> = {}) {
			return app.inject({
				method: 'POST',
				url: '/v1/admin/seed',
				headers: authHeader(token),
				payload,
			});
		}

		it('seeds the current account for staff and reports a summary', async () => {
			const staff = await signupOwner(app, { email: STAFF_EMAIL, businessName: 'Rivus HQ' });

			const response = await seed(staff.token, {
				customers: 4,
				faqs: 3,
				appointments: 2,
				notifications: 0,
				conversations: 0,
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({
				customers: 4,
				faqs: 3,
				faqsSkipped: 0,
				appointments: 2,
				notifications: 0,
				conversations: 0,
				members: 1,
				generation: 'deterministic',
			});

			// The data really landed on the account: read it back over the API.
			const customers = await app.inject({
				method: 'GET',
				url: '/v1/customers?page=1&pageSize=100',
				headers: authHeader(staff.token),
			});
			expect(customers.json().meta.total).toBe(4);
			const faqs = await app.inject({
				method: 'GET',
				url: '/v1/faqs?page=1&pageSize=100',
				headers: authHeader(staff.token),
			});
			expect(faqs.json().meta.total).toBe(3);
		});

		it('applies sensible defaults when no counts are given', async () => {
			const staff = await signupOwner(app, { email: STAFF_EMAIL, businessName: 'Rivus HQ' });
			const response = await seed(staff.token, {});
			expect(response.statusCode).toBe(200);
			const body = response.json();
			expect(body.faqs).toBe(SEED_FAQ_DEFAULT);
			expect(body.customers).toBeGreaterThanOrEqual(SEED_CUSTOMER_MIN);
		});

		it('rejects a non-staff user with 403', async () => {
			const owner = await signupOwner(app, { businessName: 'Acme Plumbing' });
			const response = await seed(owner.token);
			expect(response.statusCode).toBe(403);
		});

		it('rejects an unauthenticated request with 401', async () => {
			const response = await app.inject({ method: 'POST', url: '/v1/admin/seed', payload: {} });
			expect(response.statusCode).toBe(401);
		});

		it('rejects a count above the cap with 400', async () => {
			const staff = await signupOwner(app, { email: STAFF_EMAIL, businessName: 'Rivus HQ' });
			const response = await seed(staff.token, { customers: 10_000 });
			expect(response.statusCode).toBe(400);
		});
	});
});

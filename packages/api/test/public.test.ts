import type { AccountId } from '@rivus/core';
import { describe, expect, it } from 'vitest';
import { buildTestAppWithRepos, signupOwner } from './helpers';

describe('GET /v1/public/accounts/:slug', () => {
	it('returns only the public projection of an active account', async () => {
		const { app } = await buildTestAppWithRepos();
		const owner = await signupOwner(app);
		const response = await app.inject({
			method: 'GET',
			url: `/v1/public/accounts/${owner.account.slug}`,
		});
		expect(response.statusCode).toBe(200);
		// Exactly name + slug — no phone, address, id, status, or timestamps leak.
		expect(response.json()).toEqual({ name: owner.account.name, slug: owner.account.slug });
		await app.close();
	});

	it('404s for an unknown slug', async () => {
		const { app } = await buildTestAppWithRepos();
		const response = await app.inject({ method: 'GET', url: '/v1/public/accounts/nope' });
		expect(response.statusCode).toBe(404);
		await app.close();
	});

	it('404s for a canceled account (locked out everywhere, including here)', async () => {
		const { app, repos } = await buildTestAppWithRepos();
		const owner = await signupOwner(app);
		await repos.accounts.cancel(owner.account.id as AccountId);
		const response = await app.inject({
			method: 'GET',
			url: `/v1/public/accounts/${owner.account.slug}`,
		});
		expect(response.statusCode).toBe(404);
		await app.close();
	});
});

describe('POST /v1/public/accounts/:slug/customers', () => {
	it('creates the customer with zeroed financials and a self-signup note', async () => {
		const { app, repos } = await buildTestAppWithRepos();
		const owner = await signupOwner(app);
		const response = await app.inject({
			method: 'POST',
			url: `/v1/public/accounts/${owner.account.slug}/customers`,
			payload: {
				name: 'Dana Fox',
				email: 'Dana@Example.com',
				phone: '+1 206 555 0100',
				address: '12 Pine St',
			},
		});
		expect(response.statusCode).toBe(201);
		expect(response.json()).toEqual({ status: 'registered' });

		const created = await repos.customers.findByEmail(
			owner.account.id as AccountId,
			'dana@example.com',
		);
		expect(created).toMatchObject({
			name: 'Dana Fox',
			email: 'dana@example.com',
			phone: '+1 206 555 0100',
			address: '12 Pine St',
			lifetimeValue: 0,
			balance: 0,
			notes: 'Added via self-signup.',
		});
		await app.close();
	});

	it('is idempotent by email and does not reveal that the record existed', async () => {
		const { app, repos } = await buildTestAppWithRepos();
		const owner = await signupOwner(app);
		const accountId = owner.account.id as AccountId;
		const url = `/v1/public/accounts/${owner.account.slug}/customers`;

		const first = await app.inject({
			method: 'POST',
			url,
			payload: { name: 'Dana Fox', email: 'dana@example.com' },
		});
		const second = await app.inject({
			method: 'POST',
			url,
			payload: { name: 'Someone Else', email: 'dana@example.com' },
		});
		// Same response either way — no CRM-membership oracle.
		expect(first.statusCode).toBe(201);
		expect(second.statusCode).toBe(201);
		expect(second.json()).toEqual(first.json());

		const { total, customers } = await repos.customers.list({
			accountId,
			page: 1,
			pageSize: 10,
		});
		expect(total).toBe(1);
		// The original record was not overwritten by the second submission.
		expect(customers[0]?.name).toBe('Dana Fox');
		await app.close();
	});

	it('rejects a missing email or blank name with a friendly message', async () => {
		const { app } = await buildTestAppWithRepos();
		const owner = await signupOwner(app);
		const url = `/v1/public/accounts/${owner.account.slug}/customers`;

		const noEmail = await app.inject({ method: 'POST', url, payload: { name: 'Dana Fox' } });
		expect(noEmail.statusCode).toBe(400);
		expect(noEmail.json().message).toBe('Email address is required.');

		const blankName = await app.inject({
			method: 'POST',
			url,
			payload: { name: '   ', email: 'dana@example.com' },
		});
		expect(blankName.statusCode).toBe(400);
		await app.close();
	});

	it('404s for an unknown or canceled account without creating anything', async () => {
		const { app, repos } = await buildTestAppWithRepos();
		const owner = await signupOwner(app);
		await repos.accounts.cancel(owner.account.id as AccountId);

		const unknown = await app.inject({
			method: 'POST',
			url: '/v1/public/accounts/nope/customers',
			payload: { name: 'Dana Fox', email: 'dana@example.com' },
		});
		expect(unknown.statusCode).toBe(404);

		const canceled = await app.inject({
			method: 'POST',
			url: `/v1/public/accounts/${owner.account.slug}/customers`,
			payload: { name: 'Dana Fox', email: 'dana@example.com' },
		});
		expect(canceled.statusCode).toBe(404);

		const { total } = await repos.customers.list({
			accountId: owner.account.id as AccountId,
			page: 1,
			pageSize: 10,
		});
		expect(total).toBe(0);
		await app.close();
	});

	it('requires no authentication (the visitor is not a Rivus user)', async () => {
		const { app } = await buildTestAppWithRepos();
		const owner = await signupOwner(app);
		// No Authorization header, no cookie — still works.
		const response = await app.inject({
			method: 'POST',
			url: `/v1/public/accounts/${owner.account.slug}/customers`,
			payload: { name: 'Dana Fox', email: 'dana@example.com' },
		});
		expect(response.statusCode).toBe(201);
		await app.close();
	});
});

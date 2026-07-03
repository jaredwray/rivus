import type { Account, AccountId } from '@rivus/core';
import { describe, expect, it } from 'vitest';
import { createInMemoryData, InMemoryAccountRepository } from '../src/repositories/memory';

/**
 * Direct unit tests for the account list filter, which powers the staff company
 * switcher. These exercise a condition the HTTP tests can't: an account whose
 * stored record has no `status` at all — a legacy document created before the
 * `status` field existed. In production (Mongo) such records are common, and a
 * positive `status === 'active'` filter would hide every one of them from the
 * switcher. The switcher must exclude only *canceled* companies.
 */

const TIMESTAMP = '2026-01-01T00:00:00.000Z';

function makeAccount(fields: {
	id: string;
	name: string;
	slug: string;
	status?: Account['status'];
}): Account {
	return {
		id: fields.id as AccountId,
		name: fields.name,
		slug: fields.slug,
		phone: '',
		address: '',
		website: '',
		timezone: 'UTC',
		status: fields.status ?? 'active',
		canceledAt: null,
		createdAt: TIMESTAMP,
		updatedAt: TIMESTAMP,
	};
}

/** A record persisted before `status` existed, so it has no status field at all. */
function makeLegacyAccount(fields: { id: string; name: string; slug: string }): Account {
	const account = makeAccount(fields);
	delete (account as { status?: unknown }).status;
	return account;
}

describe('InMemoryAccountRepository.list — status filtering', () => {
	it('includes an account whose stored record predates the status field', async () => {
		const data = createInMemoryData();
		data.accounts.set(
			'active',
			makeAccount({ id: 'active', name: 'Active Co', slug: 'active-co' }),
		);
		data.accounts.set(
			'legacy',
			makeLegacyAccount({ id: 'legacy', name: 'Legacy Co', slug: 'legacy-co' }),
		);
		const repo = new InMemoryAccountRepository(data);

		const { accounts, total } = await repo.list({ page: 1, pageSize: 50 });

		expect(total).toBe(2);
		expect(accounts.map((account) => account.name)).toEqual(['Active Co', 'Legacy Co']);
	});

	it('still excludes canceled accounts', async () => {
		const data = createInMemoryData();
		data.accounts.set(
			'active',
			makeAccount({ id: 'active', name: 'Active Co', slug: 'active-co' }),
		);
		data.accounts.set(
			'canceled',
			makeAccount({ id: 'canceled', name: 'Canceled Co', slug: 'canceled-co', status: 'canceled' }),
		);
		const repo = new InMemoryAccountRepository(data);

		const { accounts, total } = await repo.list({ page: 1, pageSize: 50 });

		expect(total).toBe(1);
		expect(accounts.map((account) => account.name)).toEqual(['Active Co']);
	});

	it('matches a legacy (status-less) account by search term', async () => {
		const data = createInMemoryData();
		data.accounts.set(
			'legacy',
			makeLegacyAccount({ id: 'legacy', name: 'Beacon Electric', slug: 'beacon-electric' }),
		);
		const repo = new InMemoryAccountRepository(data);

		const { accounts } = await repo.list({ page: 1, pageSize: 50, search: 'beacon' });

		expect(accounts.map((account) => account.name)).toEqual(['Beacon Electric']);
	});
});

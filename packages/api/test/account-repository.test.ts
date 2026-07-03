import {
	type Account,
	type AccountId,
	type Customer,
	type CustomerId,
	emptyAccountChannels,
} from '@rivus/core';
import { describe, expect, it } from 'vitest';
import { ConflictError } from '../src/repositories/errors';
import {
	createInMemoryData,
	InMemoryAccountRepository,
	InMemoryCustomerRepository,
} from '../src/repositories/memory';

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
		channels: emptyAccountChannels(),
		status: fields.status ?? 'active',
		canceledAt: null,
		createdAt: TIMESTAMP,
		updatedAt: TIMESTAMP,
	};
}

function makeCustomer(fields: {
	id: string;
	accountId: string;
	name: string;
	phone: string;
}): Customer {
	return {
		id: fields.id as CustomerId,
		accountId: fields.accountId as AccountId,
		name: fields.name,
		email: '',
		phone: fields.phone,
		address: '',
		lifetimeValue: 0,
		balance: 0,
		notes: '',
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

describe('InMemoryAccountRepository — provisioned channels', () => {
	async function seededRepo() {
		const repo = new InMemoryAccountRepository(createInMemoryData());
		const account = await repo.create({
			name: 'Cascade Plumbing',
			slug: 'cascade-plumbing',
			phone: '',
			address: '',
			website: '',
			timezone: 'UTC',
		});
		return { repo, account };
	}

	it('defaults every channel to off/empty on a new account', async () => {
		const { account } = await seededRepo();
		expect(account.channels).toEqual({
			whatsapp: { enabled: false, address: '', providerRef: '' },
			sms: { enabled: false, address: '', providerRef: '' },
			voice: { enabled: false, address: '', providerRef: '' },
		});
	});

	it('setChannelConfig provisions a number and findByChannelAddress resolves it', async () => {
		const { repo, account } = await seededRepo();
		await repo.setChannelConfig(account.id, 'whatsapp', {
			enabled: true,
			address: '+15551234567',
			providerRef: 'zwa_1',
		});

		const found = await repo.findByChannelAddress('whatsapp', '+15551234567');
		expect(found?.id).toBe(account.id);
		expect(found?.channels.whatsapp).toEqual({
			enabled: true,
			address: '+15551234567',
			providerRef: 'zwa_1',
		});
		// The number is scoped to its channel — SMS with the same digits doesn't resolve.
		expect(await repo.findByChannelAddress('sms', '+15551234567')).toBeNull();
	});

	it('findByChannelAddress never matches an empty address', async () => {
		const { repo } = await seededRepo();
		expect(await repo.findByChannelAddress('whatsapp', '')).toBeNull();
	});

	it('rejects a number already provisioned to another account', async () => {
		const { repo, account } = await seededRepo();
		await repo.setChannelConfig(account.id, 'whatsapp', {
			enabled: true,
			address: '+15551234567',
			providerRef: 'zwa_1',
		});
		const other = await repo.create({
			name: 'Beacon Electric',
			slug: 'beacon-electric',
			phone: '',
			address: '',
			website: '',
			timezone: 'UTC',
		});

		await expect(
			repo.setChannelConfig(other.id, 'whatsapp', {
				enabled: true,
				address: '+15551234567',
				providerRef: 'zwa_2',
			}),
		).rejects.toBeInstanceOf(ConflictError);
	});

	it('keeps the same account able to re-set its own number', async () => {
		const { repo, account } = await seededRepo();
		const config = { enabled: true, address: '+15551234567', providerRef: 'zwa_1' };
		await repo.setChannelConfig(account.id, 'whatsapp', config);
		// Disabling retains the number (address unchanged) without a self-conflict.
		const disabled = await repo.setChannelConfig(account.id, 'whatsapp', {
			...config,
			enabled: false,
		});
		expect(disabled?.channels.whatsapp.enabled).toBe(false);
		expect(disabled?.channels.whatsapp.address).toBe('+15551234567');
	});
});

describe('InMemoryCustomerRepository.findByPhone', () => {
	it('matches a free-text CRM phone against an E.164 sender, newest-first', async () => {
		const data = createInMemoryData();
		const accountId = 'acct-1';
		data.customers.set(
			'old',
			makeCustomer({ id: 'old', accountId, name: 'Old Dana', phone: '(555) 123-4567' }),
		);
		data.customers.set(
			'new',
			makeCustomer({ id: 'new', accountId, name: 'New Dana', phone: '555.123.4567' }),
		);
		const repo = new InMemoryCustomerRepository(data);

		const match = await repo.findByPhone(accountId as AccountId, '+15551234567');
		expect(match?.name).toBe('New Dana');
	});

	it('returns null for an empty query, no match, or a different account', async () => {
		const data = createInMemoryData();
		data.customers.set(
			'c1',
			makeCustomer({ id: 'c1', accountId: 'acct-1', name: 'Dana', phone: '(555) 123-4567' }),
		);
		const repo = new InMemoryCustomerRepository(data);

		expect(await repo.findByPhone('acct-1' as AccountId, '')).toBeNull();
		expect(await repo.findByPhone('acct-1' as AccountId, '+15559999999')).toBeNull();
		expect(await repo.findByPhone('acct-2' as AccountId, '+15551234567')).toBeNull();
	});

	it('never matches an unnormalizable stored phone', async () => {
		const data = createInMemoryData();
		data.customers.set(
			'c1',
			makeCustomer({ id: 'c1', accountId: 'acct-1', name: 'Dana', phone: 'call the office' }),
		);
		const repo = new InMemoryCustomerRepository(data);

		expect(await repo.findByPhone('acct-1' as AccountId, '+15551234567')).toBeNull();
	});
});

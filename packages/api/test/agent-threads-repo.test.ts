import type { AccountId, AgentThreadId, ConversationId } from '@rivus/core';
import { describe, expect, it } from 'vitest';
import { ConflictError } from '../src/repositories/errors';
import { createInMemoryRepositories } from '../src/repositories/memory';

const ACCOUNT = 'account-1' as AccountId;
const OTHER_ACCOUNT = 'account-2' as AccountId;
const CONVERSATION = 'conversation-1' as ConversationId;

function newThreadInput(
	overrides: Partial<
		Parameters<ReturnType<typeof createInMemoryRepositories>['agentThreads']['create']>[0]
	> = {},
) {
	return {
		accountId: ACCOUNT,
		channel: 'email' as const,
		contactAddress: 'Dana@Example.com',
		conversationId: CONVERSATION,
		customerId: '',
		subject: 'Water heater',
		...overrides,
	};
}

describe('InMemoryAgentThreadRepository', () => {
	it('creates a thread in state new with a lower-cased contact address', async () => {
		const { agentThreads } = createInMemoryRepositories();
		const thread = await agentThreads.create(newThreadInput());
		expect(thread).toMatchObject({
			accountId: ACCOUNT,
			channel: 'email',
			contactAddress: 'dana@example.com',
			conversationId: CONVERSATION,
			customerId: '',
			state: 'new',
			offeredSlots: [],
			lastExternalMessageId: '',
			subject: 'Water heater',
			bookedJobId: '',
		});
	});

	it('enforces one thread per (account, channel, address)', async () => {
		const { agentThreads } = createInMemoryRepositories();
		await agentThreads.create(newThreadInput());
		await expect(
			agentThreads.create(newThreadInput({ contactAddress: 'dana@example.com' })),
		).rejects.toBeInstanceOf(ConflictError);
		// A different channel or account is a different thread.
		await expect(agentThreads.create(newThreadInput({ channel: 'sms' }))).resolves.toBeDefined();
		await expect(
			agentThreads.create(newThreadInput({ accountId: OTHER_ACCOUNT })),
		).resolves.toBeDefined();
	});

	it('finds by contact case-insensitively and scopes to the account', async () => {
		const { agentThreads } = createInMemoryRepositories();
		const created = await agentThreads.create(newThreadInput());
		expect((await agentThreads.findByContact(ACCOUNT, 'email', 'DANA@EXAMPLE.COM'))?.id).toBe(
			created.id,
		);
		expect(await agentThreads.findByContact(OTHER_ACCOUNT, 'email', 'dana@example.com')).toBeNull();
		expect(await agentThreads.findByContact(ACCOUNT, 'sms', 'dana@example.com')).toBeNull();
	});

	it('finds by id only within the owning account', async () => {
		const { agentThreads } = createInMemoryRepositories();
		const created = await agentThreads.create(newThreadInput());
		expect((await agentThreads.findById(ACCOUNT, created.id))?.id).toBe(created.id);
		expect(await agentThreads.findById(OTHER_ACCOUNT, created.id)).toBeNull();
		expect(await agentThreads.findById(ACCOUNT, 'missing' as AgentThreadId)).toBeNull();
	});

	it('applies partial machine-state patches without touching other fields', async () => {
		const { agentThreads } = createInMemoryRepositories();
		const created = await agentThreads.create(newThreadInput());
		const slots = [{ startAt: '2026-07-07T16:00:00.000Z', durationMinutes: 60 }];
		const offered = await agentThreads.update(ACCOUNT, created.id, {
			state: 'slots_offered',
			offeredSlots: slots,
			lastExternalMessageId: '<m1@x>',
		});
		expect(offered).toMatchObject({
			state: 'slots_offered',
			offeredSlots: slots,
			lastExternalMessageId: '<m1@x>',
			subject: 'Water heater',
			customerId: '',
		});
		const booked = await agentThreads.update(ACCOUNT, created.id, {
			state: 'booked',
			offeredSlots: [],
			bookedJobId: 'job-1',
			customerId: 'customer-1',
			subject: 'Re: Water heater',
			conversationId: 'conversation-2' as ConversationId,
		});
		expect(booked).toMatchObject({
			state: 'booked',
			offeredSlots: [],
			bookedJobId: 'job-1',
			customerId: 'customer-1',
			subject: 'Re: Water heater',
			conversationId: 'conversation-2',
			lastExternalMessageId: '<m1@x>',
		});
	});

	it('refuses updates from the wrong account', async () => {
		const { agentThreads } = createInMemoryRepositories();
		const created = await agentThreads.create(newThreadInput());
		expect(await agentThreads.update(OTHER_ACCOUNT, created.id, { state: 'booked' })).toBeNull();
		expect((await agentThreads.findById(ACCOUNT, created.id))?.state).toBe('new');
	});

	it('lists an account’s threads newest-updated first, and nothing for an empty account', async () => {
		const { agentThreads } = createInMemoryRepositories();
		expect(await agentThreads.listByAccount(ACCOUNT)).toEqual([]);
		const first = await agentThreads.create(newThreadInput());
		const second = await agentThreads.create(newThreadInput({ channel: 'sms' }));
		// Both were written in the same millisecond, so the newest insert leads;
		// touching the older one moves it to the front.
		expect((await agentThreads.listByAccount(ACCOUNT)).map((thread) => thread.id)).toEqual([
			second.id,
			first.id,
		]);
		await new Promise((resolve) => setTimeout(resolve, 2));
		await agentThreads.update(ACCOUNT, first.id, { state: 'booked' });
		expect((await agentThreads.listByAccount(ACCOUNT)).map((thread) => thread.id)).toEqual([
			first.id,
			second.id,
		]);
	});

	it('never lists another account’s threads', async () => {
		const { agentThreads } = createInMemoryRepositories();
		await agentThreads.create(newThreadInput());
		const other = await agentThreads.create(newThreadInput({ accountId: OTHER_ACCOUNT }));
		expect((await agentThreads.listByAccount(OTHER_ACCOUNT)).map((thread) => thread.id)).toEqual([
			other.id,
		]);
	});

	it('deletes only the owning account’s thread, and reports whether one went', async () => {
		const { agentThreads } = createInMemoryRepositories();
		const created = await agentThreads.create(newThreadInput());
		expect(await agentThreads.delete(ACCOUNT, 'missing' as AgentThreadId)).toBe(false);
		expect(await agentThreads.delete(OTHER_ACCOUNT, created.id)).toBe(false);
		expect(await agentThreads.findById(ACCOUNT, created.id)).not.toBeNull();

		expect(await agentThreads.delete(ACCOUNT, created.id)).toBe(true);
		expect(await agentThreads.findById(ACCOUNT, created.id)).toBeNull();
		// A second delete has nothing left to remove.
		expect(await agentThreads.delete(ACCOUNT, created.id)).toBe(false);
		// The contact is free again — the reset the Agent Tester relies on.
		await expect(agentThreads.create(newThreadInput())).resolves.toBeDefined();
	});
});

describe('InMemoryCustomerRepository.findByEmail', () => {
	function customerInput(email: string, name = 'Dana Fox') {
		return {
			name,
			email,
			phone: '',
			address: '',
			lifetimeValue: 0,
			balance: 0,
			notes: '',
		};
	}

	it('matches case-insensitively within the account', async () => {
		const { customers } = createInMemoryRepositories();
		const created = await customers.create(ACCOUNT, customerInput('dana@example.com'));
		expect((await customers.findByEmail(ACCOUNT, '  DANA@Example.com '))?.id).toBe(created.id);
		expect(await customers.findByEmail(OTHER_ACCOUNT, 'dana@example.com')).toBeNull();
	});

	it('never matches customers with no email on file', async () => {
		const { customers } = createInMemoryRepositories();
		await customers.create(ACCOUNT, customerInput(''));
		expect(await customers.findByEmail(ACCOUNT, '')).toBeNull();
		expect(await customers.findByEmail(ACCOUNT, '   ')).toBeNull();
	});

	it('returns the newest record when several share an address', async () => {
		const { customers } = createInMemoryRepositories();
		await customers.create(ACCOUNT, customerInput('dana@example.com', 'Old Record'));
		const newest = await customers.create(ACCOUNT, customerInput('dana@example.com', 'New Record'));
		expect((await customers.findByEmail(ACCOUNT, 'dana@example.com'))?.id).toBe(newest.id);
	});
});

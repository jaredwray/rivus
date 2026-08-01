import { randomUUID } from 'node:crypto';
import {
	type Account,
	type AccountChannelConfig,
	type AccountChannels,
	type AccountId,
	type AgentThread,
	type AgentThreadId,
	type Conversation,
	type ConversationChannel,
	type ConversationDetail,
	type ConversationId,
	type CreateConversationInput,
	type CreateCustomerInput,
	type CreateFaqInput,
	type CreateItemInput,
	type CreateJobInput,
	type CreateMessageInput,
	type CreateNotificationInput,
	type Customer,
	type CustomerId,
	type DemoLead,
	type DemoLeadId,
	emptyAccountChannels,
	type Faq,
	type FaqId,
	type Invite,
	type InviteId,
	type Item,
	type ItemId,
	type Job,
	type JobId,
	type Membership,
	type MembershipId,
	type Message,
	type MessageId,
	type Notification,
	type NotificationId,
	normalizePagination,
	normalizePhone,
	type ProvisionedChannel,
	pageToSkip,
	type Role,
	type UpdateConversationInput,
	type UpdateCustomerInput,
	type UpdateFaqInput,
	type UpdateItemInput,
	type UpdateJobInput,
	type UserId,
} from '@rivus/core';
import { ConflictError, InviteNotPendingError, LastOwnerError } from './errors';
import type {
	AcceptInviteInput,
	AcceptInviteResult,
	AccountRepository,
	AgentThreadRepository,
	ConversationRepository,
	ConversationReviewPatch,
	CustomerRepository,
	DemoLeadRepository,
	FaqRepository,
	FindOverlappingJobsOptions,
	InviteRepository,
	ItemRepository,
	JobRepository,
	ListAccountsOptions,
	ListConversationsOptions,
	ListCustomersOptions,
	ListDemoLeadsOptions,
	ListFaqsOptions,
	ListItemsOptions,
	ListJobsOptions,
	ListNotificationsOptions,
	MembershipRepository,
	NewAccount,
	NewAgentThread,
	NewDemoLead,
	NewInvite,
	NewMembership,
	NewUser,
	NewVerificationCode,
	NotificationRepository,
	OnboardingRepository,
	SearchCustomersOptions,
	SearchJobsOptions,
	SignupInput,
	SignupResult,
	StoredUser,
	StoredVerificationCode,
	UpdateAccount,
	UpdateAgentThread,
	UpdateUser,
	UserRepository,
	VerificationCodeRepository,
} from './types';

const now = (): string => new Date().toISOString();

/**
 * Shared in-memory storage. All in-memory repositories read and write the same
 * `InMemoryData` instance so a record created by one (e.g. a user written by
 * onboarding) is visible to another (e.g. login looking the user up).
 */
export interface InMemoryData {
	users: Map<string, StoredUser>;
	accounts: Map<string, Account>;
	memberships: Map<string, Membership>;
	invites: Map<string, Invite>;
	items: Map<string, Item>;
	faqs: Map<string, Faq>;
	customers: Map<string, Customer>;
	jobs: Map<string, Job>;
	notifications: Map<string, Notification>;
	/** Conversations, each carrying its own embedded message transcript. */
	conversations: Map<string, StoredConversation>;
	/** The agent's per-contact scheduling state, one per (account, channel, address). */
	agentThreads: Map<string, AgentThread>;
	/** Active one-time codes, keyed by normalized email (one per email). */
	verificationCodes: Map<string, StoredVerificationCode>;
	/** Marketing-site sales leads (demo requests, waitlist signups). */
	demoLeads: Map<string, DemoLead>;
}

export function createInMemoryData(): InMemoryData {
	return {
		users: new Map(),
		accounts: new Map(),
		memberships: new Map(),
		invites: new Map(),
		items: new Map(),
		faqs: new Map(),
		customers: new Map(),
		jobs: new Map(),
		notifications: new Map(),
		conversations: new Map(),
		agentThreads: new Map(),
		verificationCodes: new Map(),
		demoLeads: new Map(),
	};
}

/** In-memory user store — used by tests and for running the API without Mongo. */
export class InMemoryUserRepository implements UserRepository {
	constructor(private readonly data: InMemoryData) {}

	async create(input: NewUser): Promise<StoredUser> {
		const email = input.email.trim().toLowerCase();
		for (const existing of this.data.users.values()) {
			if (existing.email === email) {
				throw new ConflictError('email', 'An account with this email already exists');
			}
		}
		const timestamp = now();
		const user: StoredUser = {
			id: randomUUID() as UserId,
			email,
			name: input.name,
			phone: '',
			pendingEmail: '',
			avatarUrl: '',
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		this.data.users.set(user.id, user);
		return structuredClone(user);
	}

	async findByEmail(email: string): Promise<StoredUser | null> {
		const normalized = email.trim().toLowerCase();
		for (const user of this.data.users.values()) {
			if (user.email === normalized) {
				return structuredClone(user);
			}
		}
		return null;
	}

	async findById(id: UserId): Promise<StoredUser | null> {
		const user = this.data.users.get(id);
		return user ? structuredClone(user) : null;
	}

	async findByIds(ids: UserId[]): Promise<StoredUser[]> {
		const found: StoredUser[] = [];
		for (const id of ids) {
			const user = this.data.users.get(id);
			if (user) {
				found.push(structuredClone(user));
			}
		}
		return found;
	}

	async update(id: UserId, input: UpdateUser): Promise<StoredUser | null> {
		const user = this.data.users.get(id);
		if (!user) {
			return null;
		}
		const patch: Partial<StoredUser> = {};
		if (input.name !== undefined) {
			patch.name = input.name;
		}
		if (input.email !== undefined) {
			const normalized = input.email.trim().toLowerCase();
			// Enforce the same uniqueness as `create`, ignoring the user's own row, so a
			// verified email change can't collide with another account's address.
			for (const existing of this.data.users.values()) {
				if (existing.id !== id && existing.email === normalized) {
					throw new ConflictError('email', 'An account with this email already exists');
				}
			}
			patch.email = normalized;
		}
		if (input.phone !== undefined) {
			patch.phone = input.phone;
		}
		if (input.pendingEmail !== undefined) {
			patch.pendingEmail = input.pendingEmail.trim().toLowerCase();
		}
		if (input.avatarUrl !== undefined) {
			patch.avatarUrl = input.avatarUrl.trim();
		}
		const updated: StoredUser = { ...user, ...patch, updatedAt: now() };
		this.data.users.set(id, updated);
		return structuredClone(updated);
	}
}

/** In-memory account (business) store. */
export class InMemoryAccountRepository implements AccountRepository {
	constructor(private readonly data: InMemoryData) {}

	async create(input: NewAccount): Promise<Account> {
		const slug = input.slug.trim().toLowerCase();
		for (const existing of this.data.accounts.values()) {
			if (existing.slug === slug) {
				throw new ConflictError('slug', 'An account with this slug already exists');
			}
		}
		const timestamp = now();
		const account: Account = {
			id: randomUUID() as AccountId,
			name: input.name,
			slug,
			phone: input.phone,
			address: input.address,
			website: input.website,
			timezone: input.timezone,
			channels: emptyAccountChannels(),
			status: 'active',
			canceledAt: null,
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		this.data.accounts.set(account.id, account);
		return structuredClone(account);
	}

	async findById(id: AccountId): Promise<Account | null> {
		const account = this.data.accounts.get(id);
		return account ? structuredClone(account) : null;
	}

	async findBySlug(slug: string): Promise<Account | null> {
		const normalized = slug.trim().toLowerCase();
		for (const account of this.data.accounts.values()) {
			if (account.slug === normalized) {
				return structuredClone(account);
			}
		}
		return null;
	}

	async list(options: ListAccountsOptions): Promise<{ accounts: Account[]; total: number }> {
		const needle = options.search?.trim().toLowerCase() ?? '';
		const matched = [...this.data.accounts.values()]
			// Exclude only canceled accounts, mirroring the Mongo repository (and every
			// other account-status gate). A positive `status === 'active'` check would drop
			// any account without an explicit status — the condition that hides legacy
			// companies from the staff switcher in a real database.
			.filter((account) => account.status !== 'canceled')
			.filter(
				(account) =>
					needle === '' ||
					account.name.toLowerCase().includes(needle) ||
					account.slug.toLowerCase().includes(needle),
			)
			.sort((a, b) => a.name.localeCompare(b.name));
		const { pageSize } = normalizePagination(options.page, options.pageSize);
		const skip = pageToSkip(options.page, options.pageSize);
		return {
			accounts: matched.slice(skip, skip + pageSize).map((account) => structuredClone(account)),
			total: matched.length,
		};
	}

	async update(id: AccountId, input: UpdateAccount): Promise<Account | null> {
		const account = this.data.accounts.get(id);
		if (!account) {
			return null;
		}
		// Only overwrite fields the caller actually sent (undefined means "leave as is").
		const patch: Partial<Account> = {};
		for (const key of ['name', 'phone', 'address', 'website', 'timezone'] as const) {
			const value = input[key];
			if (value !== undefined) {
				patch[key] = value;
			}
		}
		const updated: Account = { ...account, ...patch, updatedAt: now() };
		this.data.accounts.set(id, updated);
		return structuredClone(updated);
	}

	async findByChannelAddress(
		channel: ProvisionedChannel,
		address: string,
	): Promise<Account | null> {
		if (address === '') {
			return null;
		}
		for (const account of this.data.accounts.values()) {
			if (account.channels[channel].address === address) {
				return structuredClone(account);
			}
		}
		return null;
	}

	async setChannelConfig(
		id: AccountId,
		channel: ProvisionedChannel,
		config: AccountChannelConfig,
	): Promise<Account | null> {
		const account = this.data.accounts.get(id);
		if (!account) {
			return null;
		}
		// Enforce the same cross-account uniqueness the Mongo partial index does, so
		// a provider double-assigning a number fails identically under test.
		if (config.address !== '') {
			for (const other of this.data.accounts.values()) {
				if (other.id !== id && other.channels[channel].address === config.address) {
					throw new ConflictError('address', 'That channel number is already in use');
				}
			}
		}
		const channels: AccountChannels = { ...account.channels, [channel]: { ...config } };
		const updated: Account = { ...account, channels, updatedAt: now() };
		this.data.accounts.set(id, updated);
		return structuredClone(updated);
	}

	async cancel(id: AccountId): Promise<Account | null> {
		const account = this.data.accounts.get(id);
		if (!account) {
			return null;
		}
		const timestamp = now();
		const updated: Account = {
			...account,
			status: 'canceled',
			canceledAt: timestamp,
			updatedAt: timestamp,
		};
		this.data.accounts.set(id, updated);
		return structuredClone(updated);
	}
}

/** In-memory membership (user↔account+role) store. */
export class InMemoryMembershipRepository implements MembershipRepository {
	constructor(private readonly data: InMemoryData) {}

	async create(input: NewMembership): Promise<Membership> {
		for (const existing of this.data.memberships.values()) {
			if (existing.userId === input.userId) {
				throw new ConflictError('userId', 'User already belongs to an account');
			}
		}
		const timestamp = now();
		const membership: Membership = {
			id: randomUUID() as MembershipId,
			accountId: input.accountId,
			userId: input.userId,
			role: input.role,
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		this.data.memberships.set(membership.id, membership);
		return structuredClone(membership);
	}

	async findByUserId(userId: UserId): Promise<Membership | null> {
		for (const membership of this.data.memberships.values()) {
			if (membership.userId === userId) {
				return structuredClone(membership);
			}
		}
		return null;
	}

	async findByAccountAndUser(accountId: AccountId, userId: UserId): Promise<Membership | null> {
		for (const membership of this.data.memberships.values()) {
			if (membership.accountId === accountId && membership.userId === userId) {
				return structuredClone(membership);
			}
		}
		return null;
	}

	async listByAccount(accountId: AccountId): Promise<Membership[]> {
		return [...this.data.memberships.values()]
			.filter((membership) => membership.accountId === accountId)
			.map((membership) => structuredClone(membership));
	}

	async updateRole(accountId: AccountId, userId: UserId, role: Role): Promise<Membership | null> {
		for (const membership of this.data.memberships.values()) {
			if (membership.accountId === accountId && membership.userId === userId) {
				// Demoting the last owner would orphan the account; refuse atomically.
				if (membership.role === 'owner' && role !== 'owner' && this.ownerCount(accountId) <= 1) {
					throw new LastOwnerError();
				}
				const updated: Membership = { ...membership, role, updatedAt: now() };
				this.data.memberships.set(membership.id, updated);
				return structuredClone(updated);
			}
		}
		return null;
	}

	async delete(accountId: AccountId, userId: UserId): Promise<boolean> {
		for (const membership of this.data.memberships.values()) {
			if (membership.accountId === accountId && membership.userId === userId) {
				// Removing the last owner would orphan the account; refuse atomically.
				if (membership.role === 'owner' && this.ownerCount(accountId) <= 1) {
					throw new LastOwnerError();
				}
				return this.data.memberships.delete(membership.id);
			}
		}
		return false;
	}

	/** Count the owners of an account — the invariant guarded above is "at least one". */
	private ownerCount(accountId: AccountId): number {
		let count = 0;
		for (const membership of this.data.memberships.values()) {
			if (membership.accountId === accountId && membership.role === 'owner') {
				count += 1;
			}
		}
		return count;
	}
}

/** In-memory invite store. */
export class InMemoryInviteRepository implements InviteRepository {
	constructor(private readonly data: InMemoryData) {}

	async create(input: NewInvite): Promise<Invite> {
		const timestamp = now();
		const invite: Invite = {
			id: randomUUID() as InviteId,
			accountId: input.accountId,
			email: input.email.trim().toLowerCase(),
			name: input.name,
			role: input.role,
			status: 'pending',
			token: input.token,
			invitedBy: input.invitedBy,
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		this.data.invites.set(invite.id, invite);
		return structuredClone(invite);
	}

	async findById(id: InviteId): Promise<Invite | null> {
		const invite = this.data.invites.get(id);
		return invite ? structuredClone(invite) : null;
	}

	async findByToken(token: string): Promise<Invite | null> {
		for (const invite of this.data.invites.values()) {
			if (invite.token === token) {
				return structuredClone(invite);
			}
		}
		return null;
	}

	async listPendingByAccount(accountId: AccountId): Promise<Invite[]> {
		return [...this.data.invites.values()]
			.filter((invite) => invite.accountId === accountId && invite.status === 'pending')
			.map((invite) => structuredClone(invite));
	}

	async markAccepted(id: InviteId): Promise<Invite | null> {
		const invite = this.data.invites.get(id);
		if (!invite) {
			return null;
		}
		const updated: Invite = { ...invite, status: 'accepted', updatedAt: now() };
		this.data.invites.set(id, updated);
		return structuredClone(updated);
	}

	async revoke(accountId: AccountId, id: InviteId): Promise<boolean> {
		const invite = this.data.invites.get(id);
		if (!invite || invite.accountId !== accountId || invite.status !== 'pending') {
			return false;
		}
		this.data.invites.set(id, { ...invite, status: 'revoked', updatedAt: now() });
		return true;
	}
}

/** In-memory one-time-code store, keyed by normalized email. */
export class InMemoryVerificationCodeRepository implements VerificationCodeRepository {
	constructor(private readonly data: InMemoryData) {}

	async upsert(input: NewVerificationCode): Promise<StoredVerificationCode> {
		const email = input.email.trim().toLowerCase();
		const record: StoredVerificationCode = {
			id: randomUUID(),
			email,
			purpose: input.purpose,
			codeHash: input.codeHash,
			expiresAt: input.expiresAt,
			signup: input.signup,
			emailChange: input.emailChange,
			attempts: 0,
			createdAt: now(),
		};
		// One active code per email — a new request replaces the previous one.
		this.data.verificationCodes.set(email, record);
		return structuredClone(record);
	}

	async findByEmail(email: string): Promise<StoredVerificationCode | null> {
		const record = this.data.verificationCodes.get(email.trim().toLowerCase());
		return record ? structuredClone(record) : null;
	}

	async incrementAttempts(email: string): Promise<number> {
		const key = email.trim().toLowerCase();
		const record = this.data.verificationCodes.get(key);
		if (!record) {
			return 0;
		}
		const updated: StoredVerificationCode = { ...record, attempts: record.attempts + 1 };
		this.data.verificationCodes.set(key, updated);
		return updated.attempts;
	}

	async delete(email: string): Promise<boolean> {
		return this.data.verificationCodes.delete(email.trim().toLowerCase());
	}
}

/** Sequential multi-entity writes against the shared in-memory store. */
export class InMemoryOnboardingRepository implements OnboardingRepository {
	constructor(
		private readonly users: UserRepository,
		private readonly accounts: AccountRepository,
		private readonly memberships: MembershipRepository,
		private readonly invites: InviteRepository,
	) {}

	async signup(input: SignupInput): Promise<SignupResult> {
		// `users.create` enforces email uniqueness first, so the common conflict
		// happens before the account or membership is written.
		const user = await this.users.create(input.user);
		const account = await this.accounts.create(input.account);
		const membership = await this.memberships.create({
			accountId: account.id,
			userId: user.id,
			role: 'owner',
		});
		return { user, account, membership };
	}

	async acceptInvite(input: AcceptInviteInput): Promise<AcceptInviteResult> {
		// Reject an invite that was accepted or revoked since it was looked up.
		const invite = await this.invites.findById(input.inviteId);
		if (invite?.status !== 'pending') {
			throw new InviteNotPendingError();
		}
		// Email uniqueness is enforced before the invite is consumed, so a
		// duplicate leaves the invite pending and re-acceptable.
		const user = await this.users.create(input.user);
		const membership = await this.memberships.create({
			accountId: input.accountId,
			userId: user.id,
			role: input.role,
		});
		await this.invites.markAccepted(input.inviteId);
		return { user, membership };
	}
}

/** In-memory item store, scoped by account. */
export class InMemoryItemRepository implements ItemRepository {
	constructor(private readonly data: InMemoryData) {}

	async create(accountId: AccountId, input: CreateItemInput): Promise<Item> {
		const timestamp = now();
		const item: Item = {
			id: randomUUID() as ItemId,
			accountId,
			name: input.name,
			description: input.description,
			status: input.status,
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		this.data.items.set(item.id, item);
		return structuredClone(item);
	}

	async list(options: ListItemsOptions): Promise<{ items: Item[]; total: number }> {
		// Map preserves insertion order, so reversing yields a deterministic
		// newest-first ordering even when timestamps collide within a millisecond.
		const owned = [...this.data.items.values()]
			.filter((item) => item.accountId === options.accountId)
			.reverse();
		const { pageSize } = normalizePagination(options.page, options.pageSize);
		const skip = pageToSkip(options.page, options.pageSize);
		return {
			items: owned.slice(skip, skip + pageSize).map((item) => structuredClone(item)),
			total: owned.length,
		};
	}

	async findById(accountId: AccountId, id: ItemId): Promise<Item | null> {
		const item = this.data.items.get(id);
		return item && item.accountId === accountId ? structuredClone(item) : null;
	}

	async update(accountId: AccountId, id: ItemId, input: UpdateItemInput): Promise<Item | null> {
		const item = this.data.items.get(id);
		if (!item || item.accountId !== accountId) {
			return null;
		}
		const updated: Item = { ...item, ...input, updatedAt: now() };
		this.data.items.set(id, updated);
		return structuredClone(updated);
	}

	async delete(accountId: AccountId, id: ItemId): Promise<boolean> {
		const item = this.data.items.get(id);
		if (!item || item.accountId !== accountId) {
			return false;
		}
		return this.data.items.delete(id);
	}
}

/** In-memory FAQ store, scoped by account. */
export class InMemoryFaqRepository implements FaqRepository {
	constructor(private readonly data: InMemoryData) {}

	async create(accountId: AccountId, input: CreateFaqInput): Promise<Faq> {
		const timestamp = now();
		const faq: Faq = {
			id: randomUUID() as FaqId,
			accountId,
			question: input.question,
			answer: input.answer,
			category: input.category,
			status: input.status,
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		this.data.faqs.set(faq.id, faq);
		return structuredClone(faq);
	}

	async list(options: ListFaqsOptions): Promise<{ faqs: Faq[]; total: number }> {
		// Map preserves insertion order, so reversing yields a deterministic
		// newest-first ordering even when timestamps collide within a millisecond.
		const owned = [...this.data.faqs.values()]
			.filter((faq) => faq.accountId === options.accountId)
			.reverse();
		const { pageSize } = normalizePagination(options.page, options.pageSize);
		const skip = pageToSkip(options.page, options.pageSize);
		return {
			faqs: owned.slice(skip, skip + pageSize).map((faq) => structuredClone(faq)),
			total: owned.length,
		};
	}

	async findById(accountId: AccountId, id: FaqId): Promise<Faq | null> {
		const faq = this.data.faqs.get(id);
		return faq && faq.accountId === accountId ? structuredClone(faq) : null;
	}

	async update(accountId: AccountId, id: FaqId, input: UpdateFaqInput): Promise<Faq | null> {
		const faq = this.data.faqs.get(id);
		if (!faq || faq.accountId !== accountId) {
			return null;
		}
		const updated: Faq = { ...faq, ...input, updatedAt: now() };
		this.data.faqs.set(id, updated);
		return structuredClone(updated);
	}

	async delete(accountId: AccountId, id: FaqId): Promise<boolean> {
		const faq = this.data.faqs.get(id);
		if (!faq || faq.accountId !== accountId) {
			return false;
		}
		return this.data.faqs.delete(id);
	}
}

/** In-memory customer store, scoped by account. */
export class InMemoryCustomerRepository implements CustomerRepository {
	constructor(private readonly data: InMemoryData) {}

	async create(accountId: AccountId, input: CreateCustomerInput): Promise<Customer> {
		const timestamp = now();
		const customer: Customer = {
			id: randomUUID() as CustomerId,
			accountId,
			name: input.name,
			email: input.email,
			phone: input.phone,
			address: input.address,
			lifetimeValue: input.lifetimeValue,
			balance: input.balance,
			notes: input.notes,
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		this.data.customers.set(customer.id, customer);
		return structuredClone(customer);
	}

	async list(options: ListCustomersOptions): Promise<{ customers: Customer[]; total: number }> {
		// Map preserves insertion order, so reversing yields a deterministic
		// newest-first ordering even when timestamps collide within a millisecond.
		const owned = [...this.data.customers.values()]
			.filter((customer) => customer.accountId === options.accountId)
			.reverse();
		const { pageSize } = normalizePagination(options.page, options.pageSize);
		const skip = pageToSkip(options.page, options.pageSize);
		return {
			customers: owned.slice(skip, skip + pageSize).map((customer) => structuredClone(customer)),
			total: owned.length,
		};
	}

	async search(options: SearchCustomersOptions): Promise<Customer[]> {
		const needle = options.query.trim().toLowerCase();
		if (needle === '') {
			return [];
		}
		const limit = Math.max(1, Math.trunc(options.limit));
		return (
			[...this.data.customers.values()]
				.filter((customer) => customer.accountId === options.accountId)
				.filter((customer) =>
					[customer.name, customer.email, customer.phone, customer.address, customer.notes].some(
						(field) => field.toLowerCase().includes(needle),
					),
				)
				// Newest-first, matching list() (Map preserves insertion order).
				.reverse()
				.slice(0, limit)
				.map((customer) => structuredClone(customer))
		);
	}

	async findById(accountId: AccountId, id: CustomerId): Promise<Customer | null> {
		const customer = this.data.customers.get(id);
		return customer && customer.accountId === accountId ? structuredClone(customer) : null;
	}

	async findByEmail(accountId: AccountId, email: string): Promise<Customer | null> {
		const needle = email.trim().toLowerCase();
		// Customers without an email all store '', so a blank needle must not match them.
		if (needle === '') {
			return null;
		}
		// Newest-first (Map preserves insertion order), matching list()'s ordering,
		// so the most recent record wins when several share an address.
		const match = [...this.data.customers.values()]
			.reverse()
			.find(
				(customer) => customer.accountId === accountId && customer.email.toLowerCase() === needle,
			);
		return match ? structuredClone(match) : null;
	}

	async findByPhone(accountId: AccountId, phoneE164: string): Promise<Customer | null> {
		if (phoneE164 === '') {
			return null;
		}
		// Newest-first (reverse insertion order), so the most recent record wins;
		// stored phones are free text, so both sides normalize before comparison and
		// an unnormalizable stored phone simply never matches.
		const match = [...this.data.customers.values()]
			.reverse()
			.find(
				(customer) =>
					customer.accountId === accountId && normalizePhone(customer.phone) === phoneE164,
			);
		return match ? structuredClone(match) : null;
	}

	async update(
		accountId: AccountId,
		id: CustomerId,
		input: UpdateCustomerInput,
	): Promise<Customer | null> {
		const customer = this.data.customers.get(id);
		if (!customer || customer.accountId !== accountId) {
			return null;
		}
		const updated: Customer = { ...customer, ...input, updatedAt: now() };
		this.data.customers.set(id, updated);
		return structuredClone(updated);
	}

	async delete(accountId: AccountId, id: CustomerId): Promise<boolean> {
		const customer = this.data.customers.get(id);
		if (!customer || customer.accountId !== accountId) {
			return false;
		}
		return this.data.customers.delete(id);
	}
}

/** End of a job's window, in epoch ms (start + duration). */
function jobEndMs(job: Job): number {
	return Date.parse(job.startAt) + job.durationMinutes * 60_000;
}

/** In-memory job (appointment) store, scoped by account. */
export class InMemoryJobRepository implements JobRepository {
	constructor(private readonly data: InMemoryData) {}

	async create(accountId: AccountId, input: CreateJobInput): Promise<Job> {
		const timestamp = now();
		const job: Job = {
			id: randomUUID() as JobId,
			accountId,
			customerId: input.customerId,
			assignedUserId: input.assignedUserId,
			title: input.title,
			status: input.status,
			startAt: input.startAt,
			durationMinutes: input.durationMinutes,
			address: input.address,
			notes: input.notes,
			estimatedValue: input.estimatedValue,
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		this.data.jobs.set(job.id, job);
		return structuredClone(job);
	}

	async list(options: ListJobsOptions): Promise<{ jobs: Job[]; total: number }> {
		const fromMs = options.from ? Date.parse(options.from) : undefined;
		const toMs = options.to ? Date.parse(options.to) : undefined;
		const matched = [...this.data.jobs.values()]
			.filter((job) => job.accountId === options.accountId)
			.filter((job) => fromMs === undefined || Date.parse(job.startAt) >= fromMs)
			.filter((job) => toMs === undefined || Date.parse(job.startAt) < toMs)
			.filter((job) => !options.assignedUserId || job.assignedUserId === options.assignedUserId)
			.filter((job) => !options.status || job.status === options.status)
			.filter((job) => !options.customerId || job.customerId === options.customerId)
			// A schedule reads earliest-first; tie-break on creation order so jobs that
			// share a start time stay deterministically ordered.
			.sort(
				(a, b) =>
					Date.parse(a.startAt) - Date.parse(b.startAt) || a.createdAt.localeCompare(b.createdAt),
			);
		const { pageSize } = normalizePagination(options.page, options.pageSize);
		const skip = pageToSkip(options.page, options.pageSize);
		return {
			jobs: matched.slice(skip, skip + pageSize).map((job) => structuredClone(job)),
			total: matched.length,
		};
	}

	async search(options: SearchJobsOptions): Promise<Job[]> {
		const needle = options.query.trim().toLowerCase();
		if (needle === '') {
			return [];
		}
		const limit = Math.max(1, Math.trunc(options.limit));
		return (
			[...this.data.jobs.values()]
				.filter((job) => job.accountId === options.accountId)
				.filter((job) =>
					[job.title, job.address, job.notes].some((field) => field.toLowerCase().includes(needle)),
				)
				// Newest-first, matching the customer search (Map preserves insertion order).
				.reverse()
				.slice(0, limit)
				.map((job) => structuredClone(job))
		);
	}

	async findById(accountId: AccountId, id: JobId): Promise<Job | null> {
		const job = this.data.jobs.get(id);
		return job && job.accountId === accountId ? structuredClone(job) : null;
	}

	async update(accountId: AccountId, id: JobId, input: UpdateJobInput): Promise<Job | null> {
		const job = this.data.jobs.get(id);
		if (!job || job.accountId !== accountId) {
			return null;
		}
		const updated: Job = { ...job, ...input, updatedAt: now() };
		this.data.jobs.set(id, updated);
		return structuredClone(updated);
	}

	async delete(accountId: AccountId, id: JobId): Promise<boolean> {
		const job = this.data.jobs.get(id);
		if (!job || job.accountId !== accountId) {
			return false;
		}
		return this.data.jobs.delete(id);
	}

	async findOverlapping(options: FindOverlappingJobsOptions): Promise<Job[]> {
		// Only an assigned member can be double-booked; an empty assignee never conflicts.
		if (!options.assignedUserId) {
			return [];
		}
		const windowStart = Date.parse(options.startAt);
		const windowEnd = Date.parse(options.endAt);
		return [...this.data.jobs.values()]
			.filter(
				(job) =>
					job.accountId === options.accountId &&
					job.assignedUserId === options.assignedUserId &&
					// Canceled jobs free up the slot, so they never conflict.
					job.status !== 'canceled' &&
					job.id !== options.excludeJobId &&
					// Half-open overlap: existing starts before the window ends and ends after
					// it starts. Touching edges (back-to-back jobs) don't count as a conflict.
					Date.parse(job.startAt) < windowEnd &&
					jobEndMs(job) > windowStart,
			)
			.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
			.map((job) => structuredClone(job));
	}
}

/** In-memory notification store, scoped by account and recipient user. */
export class InMemoryNotificationRepository implements NotificationRepository {
	constructor(private readonly data: InMemoryData) {}

	async create(
		accountId: AccountId,
		userId: UserId,
		input: CreateNotificationInput,
	): Promise<Notification> {
		const timestamp = now();
		const notification: Notification = {
			id: randomUUID() as NotificationId,
			accountId,
			userId,
			type: input.type,
			title: input.title,
			body: input.body,
			readState: 'unread',
			linkHref: input.linkHref,
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		this.data.notifications.set(notification.id, notification);
		return structuredClone(notification);
	}

	/** This account+user's notifications, newest-first (insertion order reversed). */
	private owned(accountId: AccountId, userId: UserId): Notification[] {
		return [...this.data.notifications.values()]
			.filter(
				(notification) => notification.accountId === accountId && notification.userId === userId,
			)
			.reverse();
	}

	async list(
		options: ListNotificationsOptions,
	): Promise<{ notifications: Notification[]; total: number }> {
		const owned = this.owned(options.accountId, options.userId).filter(
			(notification) => !options.unreadOnly || notification.readState === 'unread',
		);
		const { pageSize } = normalizePagination(options.page, options.pageSize);
		const skip = pageToSkip(options.page, options.pageSize);
		return {
			notifications: owned
				.slice(skip, skip + pageSize)
				.map((notification) => structuredClone(notification)),
			total: owned.length,
		};
	}

	async unreadCount(accountId: AccountId, userId: UserId): Promise<number> {
		return this.owned(accountId, userId).filter(
			(notification) => notification.readState === 'unread',
		).length;
	}

	async findById(
		accountId: AccountId,
		userId: UserId,
		id: NotificationId,
	): Promise<Notification | null> {
		const notification = this.data.notifications.get(id);
		return notification && notification.accountId === accountId && notification.userId === userId
			? structuredClone(notification)
			: null;
	}

	async markRead(
		accountId: AccountId,
		userId: UserId,
		id: NotificationId,
	): Promise<Notification | null> {
		const notification = this.data.notifications.get(id);
		if (!notification || notification.accountId !== accountId || notification.userId !== userId) {
			return null;
		}
		// Marking an already-read notification is a no-op that still returns it, so a
		// double-tap doesn't 404.
		const updated: Notification = { ...notification, readState: 'read', updatedAt: now() };
		this.data.notifications.set(id, updated);
		return structuredClone(updated);
	}

	async markAllRead(accountId: AccountId, userId: UserId): Promise<number> {
		let changed = 0;
		for (const notification of this.data.notifications.values()) {
			if (
				notification.accountId === accountId &&
				notification.userId === userId &&
				notification.readState === 'unread'
			) {
				this.data.notifications.set(notification.id, {
					...notification,
					readState: 'read',
					updatedAt: now(),
				});
				changed += 1;
			}
		}
		return changed;
	}

	async delete(accountId: AccountId, userId: UserId, id: NotificationId): Promise<boolean> {
		const notification = this.data.notifications.get(id);
		if (!notification || notification.accountId !== accountId || notification.userId !== userId) {
			return false;
		}
		return this.data.notifications.delete(id);
	}
}

/** A conversation plus its embedded transcript — the in-memory storage shape. */
interface StoredConversation extends Conversation {
	messages: Message[];
}

/** Strip the embedded transcript so list/find return conversation metadata only. */
function toPublicConversation(stored: StoredConversation): Conversation {
	const { messages: _messages, ...conversation } = stored;
	return structuredClone(conversation);
}

/** In-memory conversation (inbox) store, scoped by account. */
export class InMemoryConversationRepository implements ConversationRepository {
	constructor(private readonly data: InMemoryData) {}

	async create(accountId: AccountId, input: CreateConversationInput): Promise<Conversation> {
		const timestamp = now();
		const conversation: StoredConversation = {
			id: randomUUID() as ConversationId,
			accountId,
			customerId: input.customerId,
			contactName: input.contactName,
			contactPhone: input.contactPhone,
			channel: input.channel,
			status: input.status,
			snippet: '',
			tags: [...input.tags],
			lastInvoice: input.lastInvoice,
			pendingReply: '',
			flagReason: '',
			// No messages yet, so the thread sorts by when it was created.
			lastMessageAt: timestamp,
			createdAt: timestamp,
			updatedAt: timestamp,
			messages: [],
		};
		this.data.conversations.set(conversation.id, conversation);
		return toPublicConversation(conversation);
	}

	/** This account's conversations, newest activity first (insertion order breaks ties). */
	private owned(accountId: AccountId): StoredConversation[] {
		// Start newest-inserted-first, then a *stable* sort by activity keeps that
		// order for threads whose `lastMessageAt` collides within a millisecond.
		const owned = [...this.data.conversations.values()]
			.filter((conversation) => conversation.accountId === accountId)
			.reverse();
		owned.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
		return owned;
	}

	async list(
		options: ListConversationsOptions,
	): Promise<{ conversations: Conversation[]; total: number }> {
		const matched = this.owned(options.accountId).filter(
			(conversation) => !options.status || conversation.status === options.status,
		);
		const { pageSize } = normalizePagination(options.page, options.pageSize);
		const skip = pageToSkip(options.page, options.pageSize);
		return {
			conversations: matched.slice(skip, skip + pageSize).map(toPublicConversation),
			total: matched.length,
		};
	}

	async findById(accountId: AccountId, id: ConversationId): Promise<Conversation | null> {
		const conversation = this.data.conversations.get(id);
		return conversation && conversation.accountId === accountId
			? toPublicConversation(conversation)
			: null;
	}

	async update(
		accountId: AccountId,
		id: ConversationId,
		input: UpdateConversationInput,
	): Promise<Conversation | null> {
		const conversation = this.data.conversations.get(id);
		if (!conversation || conversation.accountId !== accountId) {
			return null;
		}
		const patch: Partial<StoredConversation> = {};
		if (input.contactName !== undefined) {
			patch.contactName = input.contactName;
		}
		if (input.channel !== undefined) {
			patch.channel = input.channel;
		}
		if (input.customerId !== undefined) {
			patch.customerId = input.customerId;
		}
		if (input.contactPhone !== undefined) {
			patch.contactPhone = input.contactPhone;
		}
		if (input.status !== undefined) {
			patch.status = input.status;
			// A held draft is only meaningful while a thread needs review, so moving the
			// status away from `needs_attention` clears it — a draft can't outlive its flag.
			if (input.status !== 'needs_attention') {
				patch.pendingReply = '';
				patch.flagReason = '';
			}
		}
		if (input.tags !== undefined) {
			patch.tags = [...input.tags];
		}
		if (input.lastInvoice !== undefined) {
			patch.lastInvoice = input.lastInvoice;
		}
		const updated: StoredConversation = { ...conversation, ...patch, updatedAt: now() };
		this.data.conversations.set(id, updated);
		return toPublicConversation(updated);
	}

	async delete(accountId: AccountId, id: ConversationId): Promise<boolean> {
		const conversation = this.data.conversations.get(id);
		if (!conversation || conversation.accountId !== accountId) {
			return false;
		}
		return this.data.conversations.delete(id);
	}

	async needsAttentionCount(accountId: AccountId): Promise<number> {
		return this.owned(accountId).filter((conversation) => conversation.status === 'needs_attention')
			.length;
	}

	async listMessages(accountId: AccountId, id: ConversationId): Promise<Message[] | null> {
		const conversation = this.data.conversations.get(id);
		if (!conversation || conversation.accountId !== accountId) {
			return null;
		}
		return conversation.messages.map((message) => structuredClone(message));
	}

	async addMessage(
		accountId: AccountId,
		id: ConversationId,
		input: CreateMessageInput,
	): Promise<ConversationDetail | null> {
		const conversation = this.data.conversations.get(id);
		if (!conversation || conversation.accountId !== accountId) {
			return null;
		}
		const timestamp = now();
		const message: Message = {
			id: randomUUID() as MessageId,
			conversationId: id,
			author: input.author,
			body: input.body,
			createdAt: timestamp,
		};
		conversation.messages.push(message);
		// A `note` is a system annotation, not a reply, so it bumps the activity time
		// (it belongs in the timeline) but never becomes the list preview.
		if (input.author !== 'note') {
			conversation.snippet = input.body;
		}
		conversation.lastMessageAt = timestamp;
		conversation.updatedAt = timestamp;
		this.data.conversations.set(id, conversation);
		return {
			conversation: toPublicConversation(conversation),
			messages: conversation.messages.map((entry) => structuredClone(entry)),
		};
	}

	async setReviewState(
		accountId: AccountId,
		id: ConversationId,
		patch: ConversationReviewPatch,
	): Promise<Conversation | null> {
		const conversation = this.data.conversations.get(id);
		if (!conversation || conversation.accountId !== accountId) {
			return null;
		}
		const updated: StoredConversation = {
			...conversation,
			status: patch.status,
			pendingReply: patch.pendingReply,
			flagReason: patch.flagReason,
			updatedAt: now(),
		};
		this.data.conversations.set(id, updated);
		return toPublicConversation(updated);
	}
}

/** In-memory agent-thread store — the agent's per-contact scheduling memory. */
export class InMemoryAgentThreadRepository implements AgentThreadRepository {
	constructor(private readonly data: InMemoryData) {}

	async create(input: NewAgentThread): Promise<AgentThread> {
		const address = input.contactAddress.toLowerCase();
		const existing = await this.findByContact(input.accountId, input.channel, address);
		if (existing) {
			throw new ConflictError(
				'contactAddress',
				'An agent thread already exists for this contact on this channel',
			);
		}
		const timestamp = now();
		const thread: AgentThread = {
			id: randomUUID() as AgentThreadId,
			accountId: input.accountId,
			channel: input.channel,
			// Stored lower-cased so lookups by the same contact always converge on one
			// thread, however the sending client capitalizes the address.
			contactAddress: address,
			conversationId: input.conversationId,
			customerId: input.customerId,
			state: 'new',
			offeredSlots: [],
			lastExternalMessageId: '',
			subject: input.subject,
			bookedJobId: '',
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		this.data.agentThreads.set(thread.id, thread);
		return structuredClone(thread);
	}

	async findById(accountId: AccountId, id: AgentThreadId): Promise<AgentThread | null> {
		const thread = this.data.agentThreads.get(id);
		return thread && thread.accountId === accountId ? structuredClone(thread) : null;
	}

	async findByContact(
		accountId: AccountId,
		channel: ConversationChannel,
		contactAddress: string,
	): Promise<AgentThread | null> {
		const address = contactAddress.toLowerCase();
		const match = [...this.data.agentThreads.values()].find(
			(thread) =>
				thread.accountId === accountId &&
				thread.channel === channel &&
				thread.contactAddress === address,
		);
		return match ? structuredClone(match) : null;
	}

	async findByConversationId(
		accountId: AccountId,
		conversationId: ConversationId,
	): Promise<AgentThread | null> {
		const match = [...this.data.agentThreads.values()].find(
			(thread) => thread.accountId === accountId && thread.conversationId === conversationId,
		);
		return match ? structuredClone(match) : null;
	}

	async listByAccount(accountId: AccountId): Promise<AgentThread[]> {
		// Start newest-inserted-first, then a *stable* sort by activity keeps that
		// order for threads whose `updatedAt` collides within a millisecond.
		const owned = [...this.data.agentThreads.values()]
			.filter((thread) => thread.accountId === accountId)
			.reverse();
		owned.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
		return owned.map((thread) => structuredClone(thread));
	}

	async update(
		accountId: AccountId,
		id: AgentThreadId,
		input: UpdateAgentThread,
	): Promise<AgentThread | null> {
		const thread = this.data.agentThreads.get(id);
		if (!thread || thread.accountId !== accountId) {
			return null;
		}
		const patch: Partial<AgentThread> = {};
		if (input.customerId !== undefined) {
			patch.customerId = input.customerId;
		}
		if (input.state !== undefined) {
			patch.state = input.state;
		}
		if (input.offeredSlots !== undefined) {
			patch.offeredSlots = structuredClone(input.offeredSlots);
		}
		if (input.lastExternalMessageId !== undefined) {
			patch.lastExternalMessageId = input.lastExternalMessageId;
		}
		if (input.subject !== undefined) {
			patch.subject = input.subject;
		}
		if (input.bookedJobId !== undefined) {
			patch.bookedJobId = input.bookedJobId;
		}
		if (input.conversationId !== undefined) {
			patch.conversationId = input.conversationId;
		}
		const updated: AgentThread = { ...thread, ...patch, updatedAt: now() };
		this.data.agentThreads.set(id, updated);
		return structuredClone(updated);
	}

	async delete(accountId: AccountId, id: AgentThreadId): Promise<boolean> {
		const thread = this.data.agentThreads.get(id);
		if (!thread || thread.accountId !== accountId) {
			return false;
		}
		return this.data.agentThreads.delete(id);
	}
}

/** In-memory store of marketing-site leads (global — leads precede accounts). */
export class InMemoryDemoLeadRepository implements DemoLeadRepository {
	constructor(private readonly data: InMemoryData) {}

	async create(input: NewDemoLead): Promise<DemoLead> {
		// Coalesce by (email, source): a retried submission refreshes the existing
		// lead's details rather than duplicating it. The schema lowercases emails,
		// so matching is exact. First-seen id and createdAt are kept.
		const existing = [...this.data.demoLeads.values()].find(
			(lead) => lead.email === input.email && lead.source === input.source,
		);
		if (existing) {
			const updated: DemoLead = {
				...existing,
				name: input.name,
				business: input.business,
				phone: input.phone,
				trade: input.trade,
			};
			this.data.demoLeads.set(existing.id, updated);
			return structuredClone(updated);
		}
		const lead: DemoLead = {
			id: randomUUID() as DemoLeadId,
			name: input.name,
			email: input.email,
			business: input.business,
			phone: input.phone,
			trade: input.trade,
			source: input.source,
			createdAt: now(),
		};
		this.data.demoLeads.set(lead.id, lead);
		return structuredClone(lead);
	}

	async list(options: ListDemoLeadsOptions): Promise<{ leads: DemoLead[]; total: number }> {
		// Map preserves insertion order, so reversing yields a deterministic
		// newest-first ordering even when timestamps collide within a millisecond.
		const all = [...this.data.demoLeads.values()].reverse();
		const { pageSize } = normalizePagination(options.page, options.pageSize);
		const skip = pageToSkip(options.page, options.pageSize);
		return {
			leads: all.slice(skip, skip + pageSize).map((lead) => structuredClone(lead)),
			total: all.length,
		};
	}
}

export interface InMemoryRepositories {
	data: InMemoryData;
	users: InMemoryUserRepository;
	accounts: InMemoryAccountRepository;
	memberships: InMemoryMembershipRepository;
	invites: InMemoryInviteRepository;
	items: InMemoryItemRepository;
	faqs: InMemoryFaqRepository;
	customers: InMemoryCustomerRepository;
	jobs: InMemoryJobRepository;
	notifications: InMemoryNotificationRepository;
	conversations: InMemoryConversationRepository;
	agentThreads: InMemoryAgentThreadRepository;
	verificationCodes: InMemoryVerificationCodeRepository;
	onboarding: InMemoryOnboardingRepository;
	demoLeads: InMemoryDemoLeadRepository;
}

/** Build a complete set of in-memory repositories sharing one store. */
export function createInMemoryRepositories(
	data: InMemoryData = createInMemoryData(),
): InMemoryRepositories {
	const users = new InMemoryUserRepository(data);
	const accounts = new InMemoryAccountRepository(data);
	const memberships = new InMemoryMembershipRepository(data);
	const invites = new InMemoryInviteRepository(data);
	const items = new InMemoryItemRepository(data);
	const faqs = new InMemoryFaqRepository(data);
	const customers = new InMemoryCustomerRepository(data);
	const jobs = new InMemoryJobRepository(data);
	const notifications = new InMemoryNotificationRepository(data);
	const conversations = new InMemoryConversationRepository(data);
	const agentThreads = new InMemoryAgentThreadRepository(data);
	const verificationCodes = new InMemoryVerificationCodeRepository(data);
	const onboarding = new InMemoryOnboardingRepository(users, accounts, memberships, invites);
	const demoLeads = new InMemoryDemoLeadRepository(data);
	return {
		data,
		users,
		accounts,
		memberships,
		invites,
		items,
		faqs,
		customers,
		jobs,
		notifications,
		conversations,
		agentThreads,
		verificationCodes,
		onboarding,
		demoLeads,
	};
}

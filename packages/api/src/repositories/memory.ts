import { randomUUID } from 'node:crypto';
import {
	type Account,
	type AccountId,
	type CreateCustomerInput,
	type CreateFaqInput,
	type CreateItemInput,
	type Customer,
	type CustomerId,
	type Faq,
	type FaqId,
	type Invite,
	type InviteId,
	type Item,
	type ItemId,
	type Membership,
	type MembershipId,
	normalizePagination,
	pageToSkip,
	type Role,
	type UpdateCustomerInput,
	type UpdateFaqInput,
	type UpdateItemInput,
	type UserId,
} from '@rivus/core';
import { ConflictError, InviteNotPendingError, LastOwnerError } from './errors';
import type {
	AcceptInviteInput,
	AcceptInviteResult,
	AccountRepository,
	CustomerRepository,
	FaqRepository,
	InviteRepository,
	ItemRepository,
	ListAccountsOptions,
	ListCustomersOptions,
	ListFaqsOptions,
	ListItemsOptions,
	MembershipRepository,
	NewAccount,
	NewInvite,
	NewMembership,
	NewUser,
	NewVerificationCode,
	OnboardingRepository,
	SignupInput,
	SignupResult,
	StoredUser,
	StoredVerificationCode,
	UpdateAccount,
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
	/** Active one-time codes, keyed by normalized email (one per email). */
	verificationCodes: Map<string, StoredVerificationCode>;
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
		verificationCodes: new Map(),
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
			.filter((account) => account.status === 'active')
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
			area: input.area,
			status: input.status,
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

	async findById(accountId: AccountId, id: CustomerId): Promise<Customer | null> {
		const customer = this.data.customers.get(id);
		return customer && customer.accountId === accountId ? structuredClone(customer) : null;
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

export interface InMemoryRepositories {
	data: InMemoryData;
	users: InMemoryUserRepository;
	accounts: InMemoryAccountRepository;
	memberships: InMemoryMembershipRepository;
	invites: InMemoryInviteRepository;
	items: InMemoryItemRepository;
	faqs: InMemoryFaqRepository;
	customers: InMemoryCustomerRepository;
	verificationCodes: InMemoryVerificationCodeRepository;
	onboarding: InMemoryOnboardingRepository;
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
	const verificationCodes = new InMemoryVerificationCodeRepository(data);
	const onboarding = new InMemoryOnboardingRepository(users, accounts, memberships, invites);
	return {
		data,
		users,
		accounts,
		memberships,
		invites,
		items,
		faqs,
		customers,
		verificationCodes,
		onboarding,
	};
}

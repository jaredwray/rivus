import { randomUUID } from 'node:crypto';
import {
	type Account,
	type AccountId,
	type CreateItemInput,
	type Invite,
	type InviteId,
	type Item,
	type ItemId,
	type Membership,
	type MembershipId,
	normalizePagination,
	pageToSkip,
	type Role,
	type UpdateItemInput,
	type UserId,
} from '@rivus/core';
import { ConflictError } from './errors';
import type {
	AccountRepository,
	InviteRepository,
	ItemRepository,
	ListItemsOptions,
	MembershipRepository,
	NewAccount,
	NewInvite,
	NewMembership,
	NewUser,
	OnboardingRepository,
	SignupInput,
	SignupResult,
	StoredUser,
	UserRepository,
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
}

export function createInMemoryData(): InMemoryData {
	return {
		users: new Map(),
		accounts: new Map(),
		memberships: new Map(),
		invites: new Map(),
		items: new Map(),
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
			passwordHash: input.passwordHash,
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
				return this.data.memberships.delete(membership.id);
			}
		}
		return false;
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

/** Sequential multi-entity signup against the shared in-memory store. */
export class InMemoryOnboardingRepository implements OnboardingRepository {
	constructor(
		private readonly users: UserRepository,
		private readonly accounts: AccountRepository,
		private readonly memberships: MembershipRepository,
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

export interface InMemoryRepositories {
	data: InMemoryData;
	users: InMemoryUserRepository;
	accounts: InMemoryAccountRepository;
	memberships: InMemoryMembershipRepository;
	invites: InMemoryInviteRepository;
	items: InMemoryItemRepository;
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
	const onboarding = new InMemoryOnboardingRepository(users, accounts, memberships);
	return { data, users, accounts, memberships, invites, items, onboarding };
}

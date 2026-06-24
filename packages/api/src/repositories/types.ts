import type {
	Account,
	AccountId,
	CreateItemInput,
	Invite,
	InviteId,
	Item,
	ItemId,
	Membership,
	Role,
	UpdateItemInput,
	User,
	UserId,
} from '@rivus/core';

/** A user as persisted, including the password hash (never serialized). */
export interface StoredUser extends User {
	passwordHash: string;
}

export interface NewUser {
	email: string;
	name: string;
	passwordHash: string;
}

export interface UserRepository {
	create(input: NewUser): Promise<StoredUser>;
	findByEmail(email: string): Promise<StoredUser | null>;
	findById(id: UserId): Promise<StoredUser | null>;
}

export interface NewAccount {
	name: string;
	slug: string;
	phone: string;
	address: string;
	website: string;
	timezone: string;
}

export interface AccountRepository {
	create(input: NewAccount): Promise<Account>;
	findById(id: AccountId): Promise<Account | null>;
	findBySlug(slug: string): Promise<Account | null>;
}

export interface NewMembership {
	accountId: AccountId;
	userId: UserId;
	role: Role;
}

export interface MembershipRepository {
	create(input: NewMembership): Promise<Membership>;
	/** The single membership for a user (one account per user). */
	findByUserId(userId: UserId): Promise<Membership | null>;
	findByAccountAndUser(accountId: AccountId, userId: UserId): Promise<Membership | null>;
	listByAccount(accountId: AccountId): Promise<Membership[]>;
	updateRole(accountId: AccountId, userId: UserId, role: Role): Promise<Membership | null>;
	delete(accountId: AccountId, userId: UserId): Promise<boolean>;
}

export interface NewInvite {
	accountId: AccountId;
	email: string;
	name: string;
	role: Exclude<Role, 'owner'>;
	token: string;
	invitedBy: UserId;
}

export interface InviteRepository {
	create(input: NewInvite): Promise<Invite>;
	findByToken(token: string): Promise<Invite | null>;
	/** Pending invites for an account. */
	listPendingByAccount(accountId: AccountId): Promise<Invite[]>;
	markAccepted(id: InviteId): Promise<Invite | null>;
	revoke(accountId: AccountId, id: InviteId): Promise<boolean>;
}

export interface SignupInput {
	user: NewUser;
	account: NewAccount;
}

export interface SignupResult {
	user: StoredUser;
	account: Account;
	membership: Membership;
}

/**
 * Creates the user, account, and owner membership as one unit. The Mongo
 * implementation runs this in a transaction (hence the replica set); the
 * in-memory implementation writes to a shared store.
 */
export interface OnboardingRepository {
	signup(input: SignupInput): Promise<SignupResult>;
}

export interface ListItemsOptions {
	accountId: AccountId;
	page: number;
	pageSize: number;
}

export interface ItemRepository {
	create(accountId: AccountId, input: CreateItemInput): Promise<Item>;
	list(options: ListItemsOptions): Promise<{ items: Item[]; total: number }>;
	findById(accountId: AccountId, id: ItemId): Promise<Item | null>;
	update(accountId: AccountId, id: ItemId, input: UpdateItemInput): Promise<Item | null>;
	delete(accountId: AccountId, id: ItemId): Promise<boolean>;
}

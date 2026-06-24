import type {
	Account,
	AccountBusinessInput,
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

/**
 * A user as persisted. Auth is passwordless (one-time email codes), so there is
 * no secret stored on the user record — `StoredUser` is just the public `User`.
 */
export type StoredUser = User;

export interface NewUser {
	email: string;
	name: string;
}

export interface UserRepository {
	create(input: NewUser): Promise<StoredUser>;
	findByEmail(email: string): Promise<StoredUser | null>;
	findById(id: UserId): Promise<StoredUser | null>;
	/** Fetch many users in one query (the order of the result is not guaranteed). */
	findByIds(ids: UserId[]): Promise<StoredUser[]>;
}

// --- Passwordless verification codes -----------------------------------------

export type VerificationPurpose = 'login' | 'signup';

/** Account details captured at signup, stashed on the code until it's verified. */
export interface PendingSignup {
	name: string;
	business: AccountBusinessInput;
}

export interface NewVerificationCode {
	email: string;
	purpose: VerificationPurpose;
	/** Hash of the 6-digit code; the plaintext only ever travels by email. */
	codeHash: string;
	/** ISO-8601 instant after which the code is no longer valid. */
	expiresAt: string;
	/** Present for `signup` codes; carries the account to create on verification. */
	signup?: PendingSignup;
}

export interface StoredVerificationCode extends NewVerificationCode {
	id: string;
	attempts: number;
	createdAt: string;
}

export interface VerificationCodeRepository {
	/** Store a code for an email, replacing any existing one (one active per email). */
	upsert(input: NewVerificationCode): Promise<StoredVerificationCode>;
	findByEmail(email: string): Promise<StoredVerificationCode | null>;
	/** Bump the wrong-attempt counter; returns the new count (0 if no code exists). */
	incrementAttempts(email: string): Promise<number>;
	delete(email: string): Promise<void>;
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
	findById(id: InviteId): Promise<Invite | null>;
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

export interface AcceptInviteInput {
	user: NewUser;
	accountId: AccountId;
	role: Exclude<Role, 'owner'>;
	inviteId: InviteId;
}

export interface AcceptInviteResult {
	user: StoredUser;
	membership: Membership;
}

/**
 * Multi-entity writes that must be atomic. The Mongo implementation runs each in
 * a transaction (hence the replica set); the in-memory implementation writes to
 * a shared store.
 */
export interface OnboardingRepository {
	/** Create user + account + owner membership. */
	signup(input: SignupInput): Promise<SignupResult>;
	/** Create the invitee's user + membership and mark the invite accepted. */
	acceptInvite(input: AcceptInviteInput): Promise<AcceptInviteResult>;
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

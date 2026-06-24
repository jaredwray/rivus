/**
 * Branded id type so a `UserId` can never be passed where an `ItemId` is
 * expected, even though both are strings at runtime.
 */
export type Id<TBrand extends string> = string & { readonly __brand: TBrand };

export type UserId = Id<'User'>;
export type ItemId = Id<'Item'>;
export type AccountId = Id<'Account'>;
export type MembershipId = Id<'Membership'>;
export type InviteId = Id<'Invite'>;

/** ISO-8601 timestamp, e.g. `2026-06-19T12:00:00.000Z`. */
export type IsoDateString = string;

export interface User {
	id: UserId;
	email: string;
	name: string;
	createdAt: IsoDateString;
	updatedAt: IsoDateString;
}

/**
 * A role within a business account, in ascending order of privilege:
 * - `team_member` — works in the account's data, cannot manage members.
 * - `manager` — additionally invites/removes Team Members.
 * - `owner` — full control: billing, deleting the account, and managing roles.
 */
export type Role = 'owner' | 'manager' | 'team_member';

/** A business account — the tenant that owns all of its members' data. */
export interface Account {
	id: AccountId;
	/** Business name shown throughout the product. */
	name: string;
	/** URL-safe, unique handle derived from the business name. */
	slug: string;
	phone: string;
	address: string;
	website: string;
	/** IANA time zone, e.g. `America/Los_Angeles`. */
	timezone: string;
	createdAt: IsoDateString;
	updatedAt: IsoDateString;
}

/** Join between a {@link User} and an {@link Account}, carrying the user's role. */
export interface Membership {
	id: MembershipId;
	accountId: AccountId;
	userId: UserId;
	role: Role;
	createdAt: IsoDateString;
	updatedAt: IsoDateString;
}

/** Status of an outstanding invitation to join an account. */
export type InviteStatus = 'pending' | 'accepted' | 'revoked';

/** An invitation for a new member to join an account with a given role. */
export interface Invite {
	id: InviteId;
	accountId: AccountId;
	email: string;
	name: string;
	role: Exclude<Role, 'owner'>;
	status: InviteStatus;
	/** Opaque token the invitee presents to accept the invitation. */
	token: string;
	invitedBy: UserId;
	createdAt: IsoDateString;
	updatedAt: IsoDateString;
}

export type ItemStatus = 'active' | 'archived';

export interface Item {
	id: ItemId;
	/** The account that owns this item; all members share the account's items. */
	accountId: AccountId;
	name: string;
	description: string;
	status: ItemStatus;
	createdAt: IsoDateString;
	updatedAt: IsoDateString;
}

/** A page of results plus the metadata a client needs to paginate. */
export interface Paginated<T> {
	data: T[];
	meta: PaginationMeta;
}

export interface PaginationMeta {
	page: number;
	pageSize: number;
	total: number;
	totalPages: number;
	hasNextPage: boolean;
	hasPreviousPage: boolean;
}

/** Shape every Rivus API error response follows. */
export interface ApiErrorBody {
	error: string;
	message: string;
	statusCode: number;
	details?: unknown;
}

/** Authenticated user as embedded in a verified JWT. */
export interface AuthTokenPayload {
	sub: UserId;
	email: string;
	/** Active account the token is scoped to. */
	accountId: AccountId;
	/** The user's role in that account. */
	role: Role;
}

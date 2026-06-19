/**
 * Branded id type so a `UserId` can never be passed where an `ItemId` is
 * expected, even though both are strings at runtime.
 */
export type Id<TBrand extends string> = string & { readonly __brand: TBrand };

export type UserId = Id<'User'>;
export type ItemId = Id<'Item'>;

/** ISO-8601 timestamp, e.g. `2026-06-19T12:00:00.000Z`. */
export type IsoDateString = string;

export interface User {
	id: UserId;
	email: string;
	name: string;
	createdAt: IsoDateString;
	updatedAt: IsoDateString;
}

export type ItemStatus = 'active' | 'archived';

export interface Item {
	id: ItemId;
	ownerId: UserId;
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
}

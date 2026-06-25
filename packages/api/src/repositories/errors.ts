/**
 * Thrown by a repository when a uniqueness constraint is violated (e.g. a
 * duplicate email). The API error handler maps it to HTTP 409 so both the
 * in-memory and Mongo implementations report conflicts identically.
 */
export class ConflictError extends Error {
	readonly field: string;

	constructor(field: string, message: string) {
		super(message);
		this.name = 'ConflictError';
		this.field = field;
	}
}

/**
 * Thrown when an invite is consumed but is no longer pending (already accepted
 * or revoked — possibly by a concurrent request). The API maps it to HTTP 401.
 */
export class InviteNotPendingError extends Error {
	constructor(message = 'Invalid or expired invitation') {
		super(message);
		this.name = 'InviteNotPendingError';
	}
}

/**
 * Thrown when demoting or removing a membership would leave its account with no
 * owner. The check and the write are performed atomically in the repository (a
 * transaction in Mongo) so two concurrent owner-management requests can't both
 * pass a stale count and orphan the account. The API maps it to HTTP 409.
 */
export class LastOwnerError extends Error {
	constructor(message = 'An account must always have at least one owner') {
		super(message);
		this.name = 'LastOwnerError';
	}
}

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

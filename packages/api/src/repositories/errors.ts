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

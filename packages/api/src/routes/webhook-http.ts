import type { FastifyRequest } from 'fastify';

/**
 * Provider-neutral HTTP plumbing shared by the webhook routes (Plivo, Twilio).
 */

/** First value of a possibly-repeated header, as a string. */
export function headerValue(value: string | string[] | undefined): string {
	if (Array.isArray(value)) {
		return value[0] ?? '';
	}
	return value ?? '';
}

/**
 * The public origin of a request (`https://api.rivus.ai`), honoring the
 * forwarding headers the front-door proxy sets. Used to reconstruct signed
 * webhook URLs and to build absolute callback URLs (the voice routes' action
 * attributes).
 */
export function requestOrigin(request: FastifyRequest): string {
	const proto = headerValue(request.headers['x-forwarded-proto']) || request.protocol;
	const host = headerValue(request.headers['x-forwarded-host']) || request.headers.host || '';
	return `${proto}://${host}`;
}

/**
 * Parse a provider's form-encoded callback to the same plain-object shape as
 * JSON, so payload mappers see one input. Registered plugin-scoped by each
 * webhook route that accepts `application/x-www-form-urlencoded`.
 *
 * A repeated key becomes an array (instead of silently keeping only the last
 * value): Twilio signs every occurrence, so signature verification must see
 * them all. The payload schemas expect single strings for the fields they
 * read, so a pathological repeat of a meaningful field parses as unrecognized
 * rather than as a half-read message.
 */
export function formUrlencodedParser(
	_request: FastifyRequest,
	payload: string,
	done: (error: Error | null, result?: unknown) => void,
): void {
	const form = new URLSearchParams(payload);
	const body: Record<string, string | string[]> = {};
	for (const key of new Set(form.keys())) {
		const all = form.getAll(key);
		body[key] = all.length > 1 ? all : (all[0] ?? '');
	}
	done(null, body);
}

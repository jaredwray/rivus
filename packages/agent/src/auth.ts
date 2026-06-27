import { type AccountId, roleSchema, type UserId } from '@rivus/core';
import { z } from 'zod';
import type { SessionClaims } from './types';

/**
 * Session authentication for the agent.
 *
 * The agent verifies the very same session JWT that `@rivus/api` issues, so a
 * user who is signed in to the Rivus app is automatically recognised here. The
 * token arrives one of two ways:
 *
 * - **Bearer header** — `Authorization: Bearer <jwt>` (native app, which has no
 *   cookie jar and holds the token in memory).
 * - **Cookie** — the `rivus_session` HttpOnly cookie (web app), which the browser
 *   sends automatically once the API has scoped it to the shared parent domain.
 *
 * Verification is done locally with Web Crypto (HMAC-SHA256), available in both
 * the Workers runtime and Node, which keeps this module pure and unit-testable.
 * A valid signature only proves the token was minted by us and hasn't expired —
 * the API remains the authority on live membership/permission state, so the
 * agent still forwards the token and honours any 401/403 the API returns.
 */

/** Name of the HttpOnly cookie that carries the session JWT (matches `@rivus/api`). */
export const SESSION_COOKIE = 'rivus_session';

/** Validates the decoded JWT payload carries a well-formed Rivus session. */
const claimsSchema = z.object({
	sub: z.string().min(1),
	email: z.string().min(1),
	accountId: z.string().min(1),
	role: roleSchema,
});

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Parse a `Cookie` header into a name→value map (values are URL-decoded). */
export function parseCookies(header: string | null): Record<string, string> {
	const out: Record<string, string> = {};
	if (!header) {
		return out;
	}
	for (const part of header.split(';')) {
		const eq = part.indexOf('=');
		if (eq === -1) {
			continue;
		}
		const name = part.slice(0, eq).trim();
		if (!name) {
			continue;
		}
		const rawValue = part.slice(eq + 1).trim();
		try {
			out[name] = decodeURIComponent(rawValue);
		} catch {
			// A value with a stray `%` isn't valid percent-encoding; keep it verbatim
			// rather than dropping the cookie.
			out[name] = rawValue;
		}
	}
	return out;
}

/**
 * Pull the raw session token off a request — the `Authorization: Bearer` header
 * first (native), then the `rivus_session` cookie (web). Returns `null` when
 * neither is present.
 */
export function extractSessionToken(request: Request, cookieName = SESSION_COOKIE): string | null {
	const authorization = request.headers.get('authorization');
	if (authorization) {
		const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
		if (match?.[1]) {
			return match[1].trim();
		}
	}
	const cookies = parseCookies(request.headers.get('cookie'));
	return cookies[cookieName] ?? null;
}

/** Decode a base64url segment to bytes (tolerant of missing `=` padding). */
function base64UrlToBytes(input: string): Uint8Array {
	const padded = input.length % 4 === 0 ? input : input + '='.repeat(4 - (input.length % 4));
	const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

/** Decode a base64url JWT segment to its parsed JSON, or `null` if it's malformed. */
function decodeJson(segment: string): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(decoder.decode(base64UrlToBytes(segment)));
		return typeof parsed === 'object' && parsed !== null
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

/**
 * Verify a session JWT and return its claims, or `null` for anything we don't
 * fully trust: wrong shape, an algorithm other than HS256 (so `alg: none` and
 * key-confusion attacks are rejected), a bad signature, an expired/not-yet-valid
 * token, or a missing secret.
 */
export async function verifySessionToken(
	token: string,
	secret: string | undefined,
): Promise<SessionClaims | null> {
	if (!secret) {
		return null;
	}
	const [headerSegment, payloadSegment, signatureSegment, ...rest] = token.split('.');
	if (!headerSegment || !payloadSegment || !signatureSegment || rest.length > 0) {
		return null;
	}
	const header = decodeJson(headerSegment);
	// Only accept HS256 — the algorithm the API signs with. Honouring the token's
	// own `alg` blindly would let an attacker downgrade to `none` or swap algorithms.
	// (A null header — malformed segment — also fails this check.)
	if (header?.alg !== 'HS256') {
		return null;
	}

	let signatureValid: boolean;
	try {
		const key = await crypto.subtle.importKey(
			'raw',
			encoder.encode(secret),
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['verify'],
		);
		signatureValid = await crypto.subtle.verify(
			'HMAC',
			key,
			base64UrlToBytes(signatureSegment),
			encoder.encode(`${headerSegment}.${payloadSegment}`),
		);
	} catch {
		return null;
	}
	if (!signatureValid) {
		return null;
	}

	const payload = decodeJson(payloadSegment);
	if (!payload) {
		return null;
	}
	const nowSeconds = Math.floor(Date.now() / 1000);
	if (typeof payload.exp === 'number' && payload.exp <= nowSeconds) {
		return null;
	}
	if (typeof payload.nbf === 'number' && payload.nbf > nowSeconds) {
		return null;
	}

	const claims = claimsSchema.safeParse(payload);
	if (!claims.success) {
		return null;
	}
	// The branded id types are plain strings on the wire; re-brand them here so the
	// rest of the agent gets the same precise types the API uses.
	return {
		sub: claims.data.sub as UserId,
		email: claims.data.email,
		accountId: claims.data.accountId as AccountId,
		role: claims.data.role,
	};
}

/**
 * Resolve the authenticated session for a request, or `null` when there's no
 * valid token. Convenience wrapper combining {@link extractSessionToken} and
 * {@link verifySessionToken}; also returns the raw token so callers can forward
 * it to the API.
 */
export async function authenticate(
	request: Request,
	secret: string | undefined,
): Promise<{ token: string; claims: SessionClaims } | null> {
	const token = extractSessionToken(request);
	if (!token) {
		return null;
	}
	const claims = await verifySessionToken(token, secret);
	return claims ? { token, claims } : null;
}

import type { AccountId, Role, UserId } from '@rivus/core';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { SESSION_COOKIE, sessionCookieOptions } from '../plugins/auth';

/** The claims embedded in a session JWT. */
export interface SessionClaims {
	sub: UserId;
	email: string;
	accountId: AccountId;
	role: Role;
}

/**
 * Sign a session JWT, set it as the HttpOnly session cookie (for web clients),
 * and return the token so it can also go in the response body (for native
 * clients, which have no cookie jar and send it as a bearer header). The cookie's
 * `maxAge` is derived from the token's own `exp` so the two expire together.
 *
 * Shared by every endpoint that mints a session — sign-in (`auth` routes) and the
 * staff "switch company" action (`admin` routes) — so cookie issuance stays
 * identical across them.
 */
export async function issueSession(
	app: FastifyInstance,
	reply: FastifyReply,
	payload: SessionClaims,
): Promise<string> {
	const token = await reply.jwtSign(payload);
	const decoded = app.jwt.decode<{ exp?: number }>(token);
	const maxAge = decoded?.exp ? decoded.exp - Math.floor(Date.now() / 1000) : undefined;
	reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(app.deps.config, maxAge));
	return token;
}

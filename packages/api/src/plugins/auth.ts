import fastifyCookie, { type CookieSerializeOptions } from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import { isRivusStaffEmail, type Role } from '@rivus/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Config } from '../config';

/** Name of the HttpOnly cookie that carries the session JWT for web clients. */
export const SESSION_COOKIE = 'rivus_session';

/**
 * Cookie attributes for the session cookie. It's `HttpOnly` so JavaScript can't
 * read the token (XSS can't exfiltrate it), `SameSite=Lax` because the app and
 * API are same-site subdomains of `rivus.ai` (so the cookie rides along on the
 * app's API calls while cross-site requests don't send it), and `Secure` in
 * production where everything is HTTPS. `maxAge` is passed in to match the JWT's
 * own expiry so the browser drops the cookie exactly when the token dies.
 *
 * When `COOKIE_DOMAIN` is configured (e.g. `.rivus.ai`) the cookie is scoped to
 * that parent domain so every sibling subdomain — the app and the agent — receives
 * it; left unset it stays a host-only cookie for the API alone.
 */
export function sessionCookieOptions(
	config: Config,
	maxAgeSeconds?: number,
): CookieSerializeOptions {
	return {
		httpOnly: true,
		secure: config.NODE_ENV === 'production',
		sameSite: 'lax',
		path: '/',
		...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {}),
		...(maxAgeSeconds !== undefined ? { maxAge: maxAgeSeconds } : {}),
	};
}

/** Registers JWT signing/verification plus `authenticate` and `requireRole` guards. */
export default fp(
	async (app) => {
		// The cookie parser must be registered before `@fastify/jwt` can read the
		// token from a cookie, and before any route calls `reply.setCookie`.
		await app.register(fastifyCookie);
		await app.register(fastifyJwt, {
			secret: app.deps.config.JWT_SECRET,
			sign: { expiresIn: app.deps.config.JWT_EXPIRES_IN },
			// Web clients authenticate via the HttpOnly cookie; native clients keep
			// sending the bearer token. `jwtVerify` checks the Authorization header
			// first and falls back to this cookie.
			cookie: { cookieName: SESSION_COOKIE, signed: false },
		});

		app.decorate('authenticate', async (request: FastifyRequest, _reply: FastifyReply) => {
			try {
				await request.jwtVerify();
			} catch {
				throw app.httpErrors.unauthorized('Authentication required');
			}
			// The token embeds accountId + role for speed, but membership and account
			// state can change after issuance. Revalidate against the DB so a removed
			// user loses access immediately, a role change takes effect without waiting
			// for expiry, and a canceled (soft-deleted) account locks everyone out.
			const [membership, account] = await Promise.all([
				app.deps.memberships.findByAccountAndUser(request.user.accountId, request.user.sub),
				app.deps.accounts.findById(request.user.accountId),
			]);
			// A missing account must fail closed: without this an orphaned membership
			// would authenticate and downstream handlers would assume an account exists.
			if (!account) {
				throw app.httpErrors.unauthorized('Account no longer exists');
			}
			if (account.status === 'canceled') {
				throw app.httpErrors.unauthorized('This account has been canceled');
			}
			if (membership) {
				request.user.role = membership.role;
			} else if (!isRivusStaffEmail(request.user.email)) {
				// A regular user must have a membership in the account their token is
				// scoped to; without one their access was revoked.
				throw app.httpErrors.unauthorized('Your access to this account has been revoked');
			} else {
				// Rivus staff may operate inside any active company without a membership
				// *of that company* (the "switch company" feature), keeping the role carried
				// in their staff-issued token. But they must still be an active Rivus user —
				// i.e. retain their own membership. Re-checking it here keeps revocation
				// immediate: removing a staff member's membership (offboarding) drops the
				// bypass on their next request, instead of letting a stale switched token
				// keep owner-level access to every company until the JWT expires.
				const ownMembership = await app.deps.memberships.findByUserId(request.user.sub);
				if (!ownMembership) {
					throw app.httpErrors.unauthorized('Your access to this account has been revoked');
				}
			}
		});

		// Role check reads `request.user` (populated by `authenticate`), so list it
		// first: `onRequest: [app.authenticate, app.requireRole('owner')]`.
		app.decorate('requireRole', (...roles: Role[]) => {
			return async (request: FastifyRequest, _reply: FastifyReply) => {
				if (!roles.includes(request.user.role)) {
					throw app.httpErrors.forbidden('Insufficient permissions for this action');
				}
			};
		});

		// Gate for staff-only endpoints (listing every company, switching the active
		// one). Runs after `authenticate`, which puts the token's email on `request.user`.
		app.decorate('requireStaff', async (request: FastifyRequest, _reply: FastifyReply) => {
			if (!isRivusStaffEmail(request.user.email)) {
				throw app.httpErrors.forbidden('This action is restricted to Rivus staff');
			}
		});
	},
	{ name: 'auth' },
);

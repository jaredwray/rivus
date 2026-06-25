import fastifyJwt from '@fastify/jwt';
import type { Role } from '@rivus/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

/** Registers JWT signing/verification plus `authenticate` and `requireRole` guards. */
export default fp(
	async (app) => {
		await app.register(fastifyJwt, {
			secret: app.deps.config.JWT_SECRET,
			sign: { expiresIn: app.deps.config.JWT_EXPIRES_IN },
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
			if (!membership) {
				throw app.httpErrors.unauthorized('Your access to this account has been revoked');
			}
			// A missing account must fail closed: without this an orphaned membership
			// would authenticate and downstream handlers would assume an account exists.
			if (!account) {
				throw app.httpErrors.unauthorized('Account no longer exists');
			}
			if (account.status === 'canceled') {
				throw app.httpErrors.unauthorized('This account has been canceled');
			}
			request.user.role = membership.role;
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
	},
	{ name: 'auth' },
);

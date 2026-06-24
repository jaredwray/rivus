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

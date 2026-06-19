import fastifyJwt from '@fastify/jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

/** Registers JWT signing/verification and an `authenticate` route guard. */
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
	},
	{ name: 'auth' },
);

import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { errorResponseSchema, healthResponseSchema, readyResponseSchema } from '../http-schemas';

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();

	app.get(
		'/health',
		{
			schema: {
				tags: ['system'],
				summary: 'Liveness probe',
				response: { 200: healthResponseSchema },
			},
		},
		async () => ({
			status: 'ok' as const,
			uptime: process.uptime(),
			timestamp: new Date().toISOString(),
		}),
	);

	app.get(
		'/ready',
		{
			schema: {
				tags: ['system'],
				summary: 'Readiness probe',
				response: { 200: readyResponseSchema, 503: errorResponseSchema },
			},
		},
		async (_request, reply) => {
			const readiness = await app.deps.ping();
			if (!readiness.ready) {
				return reply.status(503).send({
					error: 'Service Unavailable',
					// Surface *why* it isn't ready (e.g. the database authorization failure)
					// so it can be diagnosed by hitting the endpoint, not just the logs. The
					// reason is bounded upstream so this stays safe on a public probe.
					message: readiness.reason ?? 'Dependencies are not ready',
					statusCode: 503,
				});
			}
			return reply.status(200).send({ status: 'ready' });
		},
	);
};

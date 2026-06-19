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
			if (!(await app.deps.ping())) {
				return reply.status(503).send({
					error: 'Service Unavailable',
					message: 'Dependencies are not ready',
					statusCode: 503,
				});
			}
			return reply.status(200).send({ status: 'ready' });
		},
	);
};

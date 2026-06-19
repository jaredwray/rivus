import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { healthResponseSchema } from '../http-schemas';

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
};

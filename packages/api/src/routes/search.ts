import { type AccountId, searchQuerySchema } from '@rivus/core';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { errorResponseSchema, searchResponseSchema } from '../http-schemas';

/**
 * Global search behind the dashboard's top-bar search box. Fans the one term out
 * to each searchable repository (customers, jobs) in parallel and returns the
 * matches grouped by type. Account-scoped via the JWT, exactly like the resource
 * routes — a member only ever searches their own account's records.
 */
export const searchRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();
	const { customers, jobs } = app.deps;

	// Every search requires a valid JWT.
	app.addHook('onRequest', fastify.authenticate);

	app.get(
		'/',
		{
			schema: {
				tags: ['search'],
				summary: "Search your account's customers and jobs",
				security: [{ bearerAuth: [] }],
				querystring: searchQuerySchema,
				response: {
					200: searchResponseSchema,
					400: errorResponseSchema,
					401: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const accountId = request.user.accountId as AccountId;
			const { q, limit } = request.query;
			const [customerMatches, jobMatches] = await Promise.all([
				customers.search({ accountId, query: q, limit }),
				jobs.search({ accountId, query: q, limit }),
			]);
			return { customers: customerMatches, jobs: jobMatches };
		},
	);
};

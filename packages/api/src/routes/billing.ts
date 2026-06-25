import type { AccountId } from '@rivus/core';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { billingResponseSchema, errorResponseSchema } from '../http-schemas';

/**
 * Billing routes. Owner-only — managers and members cannot see billing. There is
 * no payment provider yet, so the summary is a placeholder derived from the
 * account's current state (every account is on the free plan).
 */
export const billingRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();
	const { memberships } = app.deps;

	app.get(
		'/',
		{
			onRequest: [fastify.authenticate, fastify.requireRole('owner')],
			schema: {
				tags: ['billing'],
				summary: 'Billing summary for the account (owner only)',
				security: [{ bearerAuth: [] }],
				response: {
					200: billingResponseSchema,
					401: errorResponseSchema,
					403: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const accountId = request.user.accountId as AccountId;
			const roster = await memberships.listByAccount(accountId);
			// `authenticate` rejects canceled accounts, so a reachable account is active.
			return { plan: 'free' as const, status: 'active' as const, seats: roster.length };
		},
	);
};

import {
	type AccountId,
	buildPaginationMeta,
	paginationQuerySchema,
	type UserId,
} from '@rivus/core';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
	accountListResponseSchema,
	authResponseSchema,
	errorResponseSchema,
	idParamsSchema,
} from '../http-schemas';
import { toPublicAccount, toPublicUser } from '../presenters';
import { issueSession } from '../services/session';

/** List query: standard pagination plus an optional free-text company search. */
const listCompaniesQuerySchema = paginationQuerySchema.extend({
	search: z
		.string()
		.trim()
		.max(160, { error: 'Search must be 160 characters or fewer.' })
		.optional(),
});

/**
 * Staff-only administration. Rivus staff (anyone with an `@rivus.ai` address) can
 * see every company and switch the active one, so support can work inside any
 * customer's account. Regular customers belong to a single account and never see
 * these routes — `requireStaff` rejects them with 403. The guard order matters:
 * `authenticate` must run first so `requireStaff` can read the token's email.
 */
export const adminRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();
	const { accounts, users, memberships } = app.deps;

	app.get(
		'/companies',
		{
			onRequest: [fastify.authenticate, fastify.requireStaff],
			schema: {
				tags: ['admin'],
				summary: 'List/search every company (Rivus staff only)',
				security: [{ bearerAuth: [] }],
				querystring: listCompaniesQuerySchema,
				response: {
					200: accountListResponseSchema,
					401: errorResponseSchema,
					403: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const { page, pageSize, search } = request.query;
			const { accounts: data, total } = await accounts.list({ page, pageSize, search });
			return {
				data: data.map(toPublicAccount),
				meta: buildPaginationMeta({ page, pageSize, total }),
			};
		},
	);

	app.post(
		'/companies/:id/switch',
		{
			onRequest: [fastify.authenticate, fastify.requireStaff],
			schema: {
				tags: ['admin'],
				summary: 'Switch the active company, re-issuing the session (Rivus staff only)',
				security: [{ bearerAuth: [] }],
				params: idParamsSchema,
				response: {
					200: authResponseSchema,
					401: errorResponseSchema,
					403: errorResponseSchema,
					404: errorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const targetId = request.params.id as AccountId;
			const account = await accounts.findById(targetId);
			// Only active companies can be entered — a canceled one is locked out for
			// everyone, so it's a 404 here rather than a session you couldn't use.
			if (!account || account.status === 'canceled') {
				throw app.httpErrors.notFound('Company not found');
			}
			const userId = request.user.sub as UserId;
			const user = await users.findById(userId);
			if (!user) {
				throw app.httpErrors.unauthorized('User no longer exists');
			}
			// Preserve a real membership role (e.g. staff switching back to their own
			// company keeps their actual role); in a company where staff have no
			// membership they operate with full owner access.
			const membership = await memberships.findByAccountAndUser(account.id, userId);
			const role = membership?.role ?? 'owner';
			const token = await issueSession(app, reply, {
				sub: user.id,
				email: user.email,
				accountId: account.id,
				role,
			});
			return reply.send({
				token,
				user: toPublicUser(user),
				account: toPublicAccount(account),
				role,
			});
		},
	);
};

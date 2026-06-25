import { type AccountId, updateAccountSchema } from '@rivus/core';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { accountResponseSchema, errorResponseSchema } from '../http-schemas';
import { toPublicAccount } from '../presenters';
import type { UpdateAccount } from '../repositories/types';

/**
 * Account-settings routes. Both are owner-only — managers and members are
 * excluded by `requireRole('owner')`, matching the rule that billing and account
 * settings are the owner's alone.
 */
export const accountRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();
	const { accounts } = app.deps;

	app.patch(
		'/',
		{
			onRequest: [fastify.authenticate, fastify.requireRole('owner')],
			schema: {
				tags: ['account'],
				summary: 'Update account business settings (owner only)',
				security: [{ bearerAuth: [] }],
				body: updateAccountSchema,
				response: {
					200: accountResponseSchema,
					400: errorResponseSchema,
					401: errorResponseSchema,
					403: errorResponseSchema,
					404: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const accountId = request.user.accountId as AccountId;
			// The public field is `businessName`; the stored field is `name`.
			const { businessName, ...rest } = request.body;
			const patch: UpdateAccount = { ...rest };
			if (businessName !== undefined) {
				patch.name = businessName;
			}
			const updated = await accounts.update(accountId, patch);
			if (!updated) {
				throw app.httpErrors.notFound('Account not found');
			}
			return toPublicAccount(updated);
		},
	);

	app.post(
		'/cancel',
		{
			onRequest: [fastify.authenticate, fastify.requireRole('owner')],
			schema: {
				tags: ['account'],
				summary: 'Cancel the account — a soft delete that locks it (owner only)',
				security: [{ bearerAuth: [] }],
				response: {
					200: accountResponseSchema,
					401: errorResponseSchema,
					403: errorResponseSchema,
					404: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const accountId = request.user.accountId as AccountId;
			// Soft delete: the row and its data stay; `authenticate` then locks every
			// session out of the canceled account on the next request.
			const canceled = await accounts.cancel(accountId);
			if (!canceled) {
				throw app.httpErrors.notFound('Account not found');
			}
			return toPublicAccount(canceled);
		},
	);
};

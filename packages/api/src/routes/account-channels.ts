import { type AccountId, provisionedChannelSchema } from '@rivus/core';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { accountResponseSchema, errorResponseSchema } from '../http-schemas';
import { toPublicAccount } from '../presenters';
import { ConflictError } from '../repositories/errors';

/**
 * Owner-only provisioning of a messaging channel. Enabling calls the provider to
 * assign a customer-facing number and stores it on the account (idempotent — a
 * re-enable never re-provisions); disabling turns the channel off but retains the
 * number so re-enabling restores the same one. Email isn't here (its address is
 * derived, always on); v1 supports WhatsApp only.
 */

const channelParamsSchema = z.object({ channel: provisionedChannelSchema });

export const accountChannelRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();
	const { accounts, whatsappProvisioner } = app.deps;

	app.post(
		'/channels/:channel/enable',
		{
			onRequest: [fastify.authenticate, fastify.requireRole('owner')],
			schema: {
				tags: ['account'],
				summary: 'Enable a messaging channel — provisions a number (owner only)',
				security: [{ bearerAuth: [] }],
				params: channelParamsSchema,
				response: {
					200: accountResponseSchema,
					400: errorResponseSchema,
					401: errorResponseSchema,
					403: errorResponseSchema,
					404: errorResponseSchema,
					409: errorResponseSchema,
					502: errorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const accountId = request.user.accountId as AccountId;
			const { channel } = request.params;
			// Only WhatsApp is wired to a provisioner today; SMS/voice are schema-ready.
			if (channel !== 'whatsapp') {
				throw app.httpErrors.badRequest('That channel is not available yet.');
			}
			const account = await accounts.findById(accountId);
			if (!account) {
				throw app.httpErrors.notFound('Account not found');
			}
			const existing = account.channels[channel];
			// Idempotent: already enabled with a number → return the account unchanged.
			if (existing.enabled && existing.address !== '') {
				return toPublicAccount(account);
			}
			let provisioned: { address: string; providerRef: string };
			try {
				provisioned = await whatsappProvisioner.provision({
					accountId,
					accountName: account.name,
					existing: { address: existing.address, providerRef: existing.providerRef },
				});
			} catch (error) {
				request.log.error({ err: error }, 'WhatsApp provisioning failed');
				// The provider is the failing dependency, so 502 (not a generic 500). Sent
				// directly: the central error handler flattens thrown 5xx into a 500.
				return reply.code(502).send({
					error: 'Bad Gateway',
					message: 'Could not provision a WhatsApp number right now. Please try again.',
					statusCode: 502,
				});
			}
			try {
				const updated = await accounts.setChannelConfig(accountId, channel, {
					enabled: true,
					address: provisioned.address,
					providerRef: provisioned.providerRef,
				});
				if (!updated) {
					throw app.httpErrors.notFound('Account not found');
				}
				return toPublicAccount(updated);
			} catch (error) {
				// The unique index rejects a number another account already holds.
				if (error instanceof ConflictError) {
					throw app.httpErrors.conflict('That number is already in use.');
				}
				throw error;
			}
		},
	);

	app.post(
		'/channels/:channel/disable',
		{
			onRequest: [fastify.authenticate, fastify.requireRole('owner')],
			schema: {
				tags: ['account'],
				summary: 'Disable a messaging channel — retains the number (owner only)',
				security: [{ bearerAuth: [] }],
				params: channelParamsSchema,
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
			const { channel } = request.params;
			if (channel !== 'whatsapp') {
				throw app.httpErrors.badRequest('That channel is not available yet.');
			}
			const account = await accounts.findById(accountId);
			if (!account) {
				throw app.httpErrors.notFound('Account not found');
			}
			const existing = account.channels[channel];
			// Retain the number (address/providerRef) so re-enabling restores it.
			const updated = await accounts.setChannelConfig(accountId, channel, {
				enabled: false,
				address: existing.address,
				providerRef: existing.providerRef,
			});
			if (!updated) {
				throw app.httpErrors.notFound('Account not found');
			}
			return toPublicAccount(updated);
		},
	);
};

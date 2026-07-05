import { type Account, type AccountId, provisionedChannelSchema } from '@rivus/core';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Config } from '../config';
import { accountResponseSchema, errorResponseSchema } from '../http-schemas';
import { toPublicAccount } from '../presenters';
import { ConflictError } from '../repositories/errors';
import type { ChannelProvisioner, ProvisionedIdentifier } from '../services/channel-provisioning';
import { plivoOwnedIdentifier } from '../services/plivo';

/**
 * Owner-only provisioning of a messaging channel. Enabling calls the provider to
 * assign a customer-facing number and stores it on the account (idempotent — a
 * re-enable never re-provisions); disabling turns the channel off but retains the
 * number so re-enabling restores the same one. Email isn't here (its address is
 * derived, always on); WhatsApp and SMS are provisionable, voice is reserved.
 *
 * One number, every channel: when a channel is enabled and its sibling already
 * holds a Plivo-owned number, that number is adopted instead of renting a
 * second one — Plivo fronts WhatsApp and SMS (and later voice) on the same
 * number. Numbers Plivo does not own (zernio's, the dev fakes) are never
 * shared onto a channel Plivo would have to send from.
 */

const channelParamsSchema = z.object({ channel: provisionedChannelSchema });

/** The channels an owner can provision today (voice is schema-ready, not built). */
const PROVISIONABLE = ['whatsapp', 'sms'] as const;
type ProvisionableChannel = (typeof PROVISIONABLE)[number];

function isProvisionable(channel: string): channel is ProvisionableChannel {
	return (PROVISIONABLE as readonly string[]).includes(channel);
}

/**
 * Whether a real provider backs this channel in the current config — the same
 * predicates the sender/provisioner factories use (`messaging-provider.ts`).
 */
function providerConfigured(config: Config, channel: ProvisionableChannel): boolean {
	const plivo = Boolean(config.PLIVO_AUTH_ID && config.PLIVO_AUTH_TOKEN);
	if (channel === 'sms') {
		return plivo;
	}
	return plivo || Boolean(config.ZERNIO_API_KEY);
}

/**
 * The identifier to hand the provisioner: the channel's own (idempotent
 * re-enable), else a sibling channel's Plivo-owned number (adopted, so both
 * channels share one number), else empty (a fresh rental).
 *
 * Known race, accepted: two enables for the same account arriving together can
 * each read empty siblings and rent two numbers. The app serializes its
 * toggles (one busy request at a time), so the residual window is a deliberate
 * double-submit; recovery is releasing the extra number in the Plivo console.
 * Closing it fully needs a per-account claim/lock this API deliberately
 * doesn't have.
 */
function existingOrShared(account: Account, channel: ProvisionableChannel): ProvisionedIdentifier {
	const own = account.channels[channel];
	if (own.address !== '') {
		return { address: own.address, providerRef: own.providerRef };
	}
	for (const sibling of PROVISIONABLE) {
		if (sibling === channel) {
			continue;
		}
		const shared = plivoOwnedIdentifier(account.channels[sibling]);
		if (shared) {
			return shared;
		}
	}
	return { address: '', providerRef: '' };
}

export const accountChannelRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();
	const { accounts, config, whatsappProvisioner, smsProvisioner } = app.deps;

	const provisioners: Record<ProvisionableChannel, ChannelProvisioner> = {
		whatsapp: whatsappProvisioner,
		sms: smsProvisioner,
	};

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
					503: errorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const accountId = request.user.accountId as AccountId;
			const { channel } = request.params;
			if (!isProvisionable(channel)) {
				throw app.httpErrors.badRequest('That channel is not available yet.');
			}
			// In production a channel with no real provider must never hand out a
			// number: the no-op provisioner would mint a fake +1555… and every reply
			// would be silently dropped. Dev/test keep the no-op flow on purpose.
			// Sent directly: the central error handler flattens thrown 5xx into a 500.
			if (config.NODE_ENV === 'production' && !providerConfigured(config, channel)) {
				return reply.code(503).send({
					error: 'Service Unavailable',
					message: 'That channel is not configured on this deployment.',
					statusCode: 503,
				});
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
			let provisioned: ProvisionedIdentifier;
			try {
				provisioned = await provisioners[channel].provision({
					accountId,
					accountName: account.name,
					existing: existingOrShared(account, channel),
				});
			} catch (error) {
				request.log.error({ err: error, channel }, 'channel provisioning failed');
				// The provider is the failing dependency, so 502 (not a generic 500). Sent
				// directly: the central error handler flattens thrown 5xx into a 500.
				return reply.code(502).send({
					error: 'Bad Gateway',
					message: 'Could not provision a number right now. Please try again.',
					statusCode: 502,
				});
			}
			// A number belongs to at most one account across ALL phone channels. The
			// per-channel unique indexes catch same-channel clashes at write time;
			// this route-level sweep (the only path that writes numbers) also catches
			// a provider double-assigning a number another account already holds on
			// the sibling channel — which Mongo can't express as a single index. The
			// account's own sibling holding the number is exactly the sharing feature.
			for (const other of PROVISIONABLE) {
				const holder = await accounts.findByChannelAddress(other, provisioned.address);
				if (holder && holder.id !== accountId) {
					throw app.httpErrors.conflict('That number is already in use.');
				}
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
			if (!isProvisionable(channel)) {
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

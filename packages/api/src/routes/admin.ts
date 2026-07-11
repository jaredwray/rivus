import {
	type AccountId,
	buildPaginationMeta,
	paginationQuerySchema,
	seedAccountSchema,
	type UserId,
} from '@rivus/core';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { isSeedingEnabled } from '../config';
import {
	accountListResponseSchema,
	accountResponseSchema,
	authResponseSchema,
	errorResponseSchema,
	idParamsSchema,
	seedSummaryResponseSchema,
} from '../http-schemas';
import { toPublicAccount, toPublicUser } from '../presenters';
import { NOOP_PROVIDER_REF, type ReleaseOutcome } from '../services/channel-provisioning';
import { issueSession } from '../services/session';
import {
	TWILIO_SANDBOX_PROVIDER_REF,
	TWILIO_WHATSAPP_SANDBOX_NUMBER,
	twilioOwnsRef,
} from '../services/twilio';

/** List query: standard pagination plus an optional free-text company search. */
const listCompaniesQuerySchema = paginationQuerySchema.extend({
	search: z
		.string()
		.trim()
		.max(160, { error: 'Search must be 160 characters or fewer.' })
		.optional(),
});

/** Body of the dev-only WhatsApp-sandbox switch: attach (default) or detach. */
const sandboxWhatsappSchema = z.object({
	mode: z.enum(['attach', 'detach']).default('attach'),
});

/** The phone-backed channels the dev-only release-and-reset flow clears. */
const PHONE_CHANNELS = ['whatsapp', 'sms', 'voice'] as const;

/**
 * Whether a channel config has no rental behind it: a dev fake, the shared
 * sandbox marker, or nothing at all. Inert channels are safe to wipe without a
 * provider call; anything else either is a Twilio rental (released first) or
 * belongs to another provider (refused — see the release-number route).
 */
function isInertChannel(config: { address: string; providerRef: string }): boolean {
	return (
		config.providerRef === NOOP_PROVIDER_REF ||
		config.providerRef === TWILIO_SANDBOX_PROVIDER_REF ||
		(config.providerRef === '' && config.address === '')
	);
}

/** Body of the dev-only release-and-reset flow. */
const releaseNumberSchema = z.object({
	/**
	 * Also forget numbers Twilio doesn't know under this deployment's account
	 * (404 on release). Off by default: such a number may have been rented by a
	 * different Twilio account (rotated credentials) and still bill there, so
	 * dropping the account's record of it must be an explicit choice.
	 */
	clearUnknown: z.boolean().default(false),
});

/**
 * Response of the release-and-reset flow: the numbers Twilio confirmed
 * released, the ones forgotten without confirmation (unknown to this
 * deployment's Twilio account, cleared via `clearUnknown`), and the reset
 * account.
 */
const releaseNumberResponseSchema = z.object({
	released: z.array(z.string()),
	forgotten: z.array(z.string()),
	account: accountResponseSchema,
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
				agentEmailDomain: app.deps.config.AGENT_EMAIL_DOMAIN,
			});
		},
	);

	// Development-only account seeder. Both deployed containers run
	// `NODE_ENV=production` (see app.ts), so this route keys off `RIVUS_ENV` instead:
	// it's registered on a local dev API (`NODE_ENV=development`) and on the deployed
	// `development` environment (`RIVUS_ENV=development`, dev-api.rivus.ai), but never
	// in production — where it doesn't exist (404) — and even then it's gated to Rivus
	// staff (`@rivus.ai`). It fills the *current* account with demo customers, FAQs,
	// appointments, notifications, and inbox conversations so staff can populate a
	// fresh test account from the app's Settings screen without touching the CLI.
	if (isSeedingEnabled(app.deps.config)) {
		// Lazy-load the seeder so its dev-only `@faker-js/faker` dependency (and the AI
		// generation machinery) is split into a chunk imported only when seeding is
		// enabled — never in the production startup bundle. faker is a devDependency, so
		// tsdown *bundles* it into that chunk rather than leaving an external import;
		// that's what lets the chunk load on the deployed dev container (which runs
		// NODE_ENV=production, with devDependencies pruned from node_modules) without
		// faker being a runtime dependency. `adminRoutes` is async, so awaiting an
		// import during registration is fine.
		const [{ createSeedGenerator, DeterministicSeedGenerator }, { seedAccountData }] =
			await Promise.all([import('../seed-ai'), import('../services/seed')]);
		const { customers, faqs, jobs, notifications, conversations } = app.deps;
		app.post(
			'/seed',
			{
				onRequest: [fastify.authenticate, fastify.requireStaff],
				schema: {
					tags: ['admin'],
					summary: 'Seed the current account with demo data (development only, Rivus staff only)',
					security: [{ bearerAuth: [] }],
					body: seedAccountSchema,
					response: {
						200: seedSummaryResponseSchema,
						401: errorResponseSchema,
						403: errorResponseSchema,
						404: errorResponseSchema,
					},
				},
			},
			async (request) => {
				const account = await accounts.findById(request.user.accountId as AccountId);
				if (!account) {
					throw app.httpErrors.notFound('Account not found');
				}
				const body = request.body;
				// `ai` opts into AI-tailored data when a provider key is set (it degrades to
				// deterministic generation otherwise); without it the seed is fully
				// deterministic, so a button press never makes a surprise external call.
				const generator = body.ai
					? createSeedGenerator(app.deps.config)
					: new DeterministicSeedGenerator();
				return seedAccountData(
					{ customers, faqs, jobs, notifications, conversations, memberships },
					generator,
					account,
					{
						customers: body.customers,
						faqs: body.faqs,
						appointments: body.appointments,
						notifications: body.notifications,
						conversations: body.conversations,
					},
					{ seed: body.seed, log: (message) => request.log.info(message) },
				);
			},
		);

		// Development-only WhatsApp sandbox switch, gated exactly like the seeder.
		// Twilio's sandbox is the zero-compliance way to test WhatsApp end-to-end
		// (no WABA, no sender registration, real inbound webhooks), but inbound
		// resolution matches on the account's stored channel address — and the
		// enable flow can't rent the shared sandbox number. This flips the current
		// account's WhatsApp channel onto the sandbox number (and back off it),
		// with guards so it can never clobber a real provisioned number. Setup that
		// stays in the Twilio console: point the sandbox's inbound webhook at
		// /v1/channels/whatsapp/twilio/inbound and have testers send the join code.
		app.post(
			'/sandbox/whatsapp',
			{
				onRequest: [fastify.authenticate, fastify.requireStaff],
				schema: {
					tags: ['admin'],
					summary:
						'Point this account’s WhatsApp at the Twilio sandbox (development only, Rivus staff only)',
					description:
						'Attaches the current account’s WhatsApp channel to Twilio’s shared ' +
						'sandbox number so sandbox conversations reach the scheduling agent — ' +
						'or detaches it again. Attach refuses to replace a real provisioned ' +
						'number, and detach only ever clears the sandbox number. Configure the ' +
						'sandbox’s inbound webhook (Console → Messaging → Try it out) to this ' +
						'API’s /v1/channels/whatsapp/twilio/inbound route.',
					security: [{ bearerAuth: [] }],
					body: sandboxWhatsappSchema,
					response: {
						200: accountResponseSchema,
						401: errorResponseSchema,
						403: errorResponseSchema,
						404: errorResponseSchema,
						409: errorResponseSchema,
					},
				},
			},
			async (request) => {
				const accountId = request.user.accountId as AccountId;
				const account = await accounts.findById(accountId);
				if (!account) {
					throw app.httpErrors.notFound('Account not found');
				}
				const whatsapp = account.channels.whatsapp;
				if (request.body.mode === 'detach') {
					// Only ever clear the sandbox number — never a real one.
					if (whatsapp.address !== TWILIO_WHATSAPP_SANDBOX_NUMBER) {
						throw app.httpErrors.conflict('This account is not on the WhatsApp sandbox.');
					}
					const updated = await accounts.setChannelConfig(accountId, 'whatsapp', {
						enabled: false,
						address: '',
						providerRef: '',
					});
					if (!updated) {
						throw app.httpErrors.notFound('Account not found');
					}
					return toPublicAccount(updated);
				}
				// Attach. A real provisioned number is the account's retained identity —
				// replacing it would orphan the rental, so refuse instead.
				if (whatsapp.address !== '' && whatsapp.address !== TWILIO_WHATSAPP_SANDBOX_NUMBER) {
					throw app.httpErrors.conflict(
						'This account already has a WhatsApp number; the sandbox would replace it.',
					);
				}
				// The repositories' cross-account uniqueness makes a second account's
				// attach fail with a 409 — one sandbox tenant per deployment.
				const updated = await accounts.setChannelConfig(accountId, 'whatsapp', {
					enabled: true,
					address: TWILIO_WHATSAPP_SANDBOX_NUMBER,
					providerRef: TWILIO_SANDBOX_PROVIDER_REF,
				});
				if (!updated) {
					throw app.httpErrors.notFound('Account not found');
				}
				return toPublicAccount(updated);
			},
		);

		// Development-only "release & reset" — the undo of channel enablement, for
		// when a dev number lands in a broken state (dead inbound routing, webhooks
		// missed at purchase) and the fastest fix is starting over. Releases every
		// Twilio-rented number the account holds (deduped, so a number shared across
		// channels is released once), resetting each rental's channels as its release
		// is confirmed, then sweeps the inert leftovers (dev fakes, the sandbox
		// marker) so all three phone channels end disabled/empty and the next enable
		// rents fresh. The one invariant: never destroy the account's only pointer to
		// a number that may still bill — so a rental this deployment can't release
		// (another provider's, or no credentials) refuses with 409, and a mid-batch
		// provider failure stops with the unreleased numbers still visible. Production
		// deliberately never releases — disable retains the number — so this exists
		// only where seeding is enabled.
		app.post(
			'/release-number',
			{
				onRequest: [fastify.authenticate, fastify.requireStaff],
				schema: {
					tags: ['admin'],
					summary:
						'Release this account’s rented numbers and reset its phone channels (development only, Rivus staff only)',
					description:
						'Releases every Twilio-rented number the current account holds, ' +
						'resetting each rental’s channels once its release is confirmed, then ' +
						'clears sandbox/dev-fake leftovers, so the WhatsApp, SMS, and voice ' +
						'channels end disabled with no number and the next enable rents fresh. ' +
						'Refuses (409) when the account holds a number this deployment cannot ' +
						'release (another provider’s rental, or no Twilio credentials) — and ' +
						'when Twilio doesn’t know a number under this account (already ' +
						'console-released, or a different Twilio account’s rental that may ' +
						'still bill), unless `clearUnknown` explicitly forgets it. If Twilio ' +
						'refuses a release mid-batch (502), already-released numbers are reset ' +
						'and the remaining ones stay visible on the account.',
					security: [{ bearerAuth: [] }],
					body: releaseNumberSchema,
					response: {
						200: releaseNumberResponseSchema,
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
				const account = await accounts.findById(accountId);
				if (!account) {
					throw app.httpErrors.notFound('Account not found');
				}
				// Partition the account's refs. Only `PN…` fingerprints name a rental
				// this deployment can release; inert refs (dev fakes, the sandbox
				// marker, nothing) have no rental behind them; anything else — Plivo's
				// bare digits, zernio's opaque ids — is a live rental owned elsewhere.
				// Wiping one of those would orphan a number that keeps billing, so the
				// whole reset refuses up front and touches nothing.
				const rented = new Map<string, string>();
				const foreign: string[] = [];
				for (const channel of PHONE_CHANNELS) {
					const config = account.channels[channel];
					if (twilioOwnsRef(config.providerRef)) {
						rented.set(config.providerRef, config.address);
					} else if (!isInertChannel(config)) {
						foreign.push(config.address);
					}
				}
				if (foreign.length > 0) {
					throw app.httpErrors.conflict(
						`This deployment can't release ${[...new Set(foreign)].join(', ')} — ` +
							'clean that number up in its own provider’s console, or use a fresh test account.',
					);
				}
				// Clear every channel currently holding `ref`. Matching on the *current*
				// ref (not the snapshot) means a channel re-enabled mid-flight — a new
				// rental with a different ref — is left alone rather than orphaned.
				const clearChannelsHolding = async (ref: string) => {
					const current = await accounts.findById(accountId);
					for (const channel of PHONE_CHANNELS) {
						if (current?.channels[channel].providerRef === ref) {
							await accounts.setChannelConfig(accountId, channel, {
								enabled: false,
								address: '',
								providerRef: '',
							});
						}
					}
				};
				// Release ref by ref, resetting each rental's channels as soon as its
				// release is confirmed — the account never shows a released (dead)
				// number as live, and never loses an unreleased one.
				const released: string[] = [];
				const forgotten: string[] = [];
				for (const [providerRef, address] of rented) {
					let outcome: ReleaseOutcome;
					try {
						outcome = await app.deps.numberReleaser.release(providerRef, request.log);
					} catch (error) {
						request.log.error({ err: error, providerRef }, 'number release failed');
						// This rental may still be billing, so its channels keep pointing at
						// it; anything released before it is already reset. The provider is
						// the failing dependency, so 502; sent directly (the central error
						// handler flattens thrown 5xx into a 500).
						return reply.code(502).send({
							error: 'Bad Gateway',
							message:
								released.length > 0
									? `Twilio refused to release ${address}. Already released and reset: ` +
										`${released.join(', ')}. The rest is untouched — try again.`
									: `Twilio refused to release ${address}. Nothing was reset.`,
							statusCode: 502,
						});
					}
					// 'skipped' = no credentials to release with. The rental is still
					// live, so refuse rather than wipe the account's only pointer to it.
					if (outcome === 'skipped') {
						throw app.httpErrors.conflict(
							'This deployment has no Twilio credentials to release numbers with, so nothing was reset.',
						);
					}
					// 'not_found' is ambiguous: the number is gone from *this* Twilio
					// account — released in the console, or rented by a different account
					// and still billing there. Forget it only on explicit say-so.
					if (outcome === 'not_found' && !request.body.clearUnknown) {
						throw app.httpErrors.conflict(
							`Twilio doesn't know ${address} under this deployment's account — either it ` +
								'was already released in the console, or it belongs to a different Twilio ' +
								'account and may still bill there. If it is truly gone, run again with ' +
								'clearUnknown to forget it.' +
								(released.length > 0 ? ` Already released and reset: ${released.join(', ')}.` : ''),
						);
					}
					(outcome === 'released' ? released : forgotten).push(address);
					await clearChannelsHolding(providerRef);
				}
				// Sweep the inert leftovers ('noop' fakes, the sandbox marker) so every
				// phone channel ends factory-fresh. Released channels are already clean,
				// and a rental that appeared mid-flight is not inert, so it survives.
				const current = await accounts.findById(accountId);
				if (!current) {
					throw app.httpErrors.notFound('Account not found');
				}
				let updated = current;
				for (const channel of PHONE_CHANNELS) {
					const config = updated.channels[channel];
					const clean = !config.enabled && config.address === '' && config.providerRef === '';
					if (clean || !isInertChannel(config)) {
						continue;
					}
					const next = await accounts.setChannelConfig(accountId, channel, {
						enabled: false,
						address: '',
						providerRef: '',
					});
					if (!next) {
						throw app.httpErrors.notFound('Account not found');
					}
					updated = next;
				}
				return { released, forgotten, account: toPublicAccount(updated) };
			},
		);
	}
};

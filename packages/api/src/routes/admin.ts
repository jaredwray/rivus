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
import { issueSession } from '../services/session';
import { TWILIO_SANDBOX_PROVIDER_REF, TWILIO_WHATSAPP_SANDBOX_NUMBER } from '../services/twilio';

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
	}
};

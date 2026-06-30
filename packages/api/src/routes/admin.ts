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
	authResponseSchema,
	errorResponseSchema,
	idParamsSchema,
	seedSummaryResponseSchema,
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
	}
};

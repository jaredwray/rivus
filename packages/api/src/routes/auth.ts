import {
	type AccountId,
	acceptInviteSchema,
	loginSchema,
	signupSchema,
	type UserId,
} from '@rivus/core';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authResponseSchema, errorResponseSchema, sessionResponseSchema } from '../http-schemas';
import { toPublicAccount, toPublicUser } from '../presenters';
import { generateUniqueSlug } from '../services/accounts';
import { dummyPasswordHash, hashPassword, verifyPassword } from '../services/password';

export const authRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();
	const { users, accounts, memberships, invites, onboarding } = app.deps;

	app.post(
		'/signup',
		{
			schema: {
				tags: ['auth'],
				summary: 'Create a business account and its owner',
				body: signupSchema,
				response: {
					201: authResponseSchema,
					400: errorResponseSchema,
					409: errorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const { email, password, name, business } = request.body;
			const passwordHash = await hashPassword(password);
			const slug = await generateUniqueSlug(accounts, business.businessName);
			// Creates user + account + owner membership atomically (a Mongo
			// transaction in production; a shared store in tests). Email uniqueness
			// is enforced first, so a duplicate never leaves an orphan account.
			const { user, account, membership } = await onboarding.signup({
				user: { email, name, passwordHash },
				account: {
					name: business.businessName,
					slug,
					phone: business.phone,
					address: business.address,
					website: business.website,
					timezone: business.timezone,
				},
			});
			const token = await reply.jwtSign({
				sub: user.id,
				email: user.email,
				accountId: account.id,
				role: membership.role,
			});
			return reply.code(201).send({
				token,
				user: toPublicUser(user),
				account: toPublicAccount(account),
				role: membership.role,
			});
		},
	);

	app.post(
		'/login',
		{
			schema: {
				tags: ['auth'],
				summary: 'Log in and receive a JWT',
				body: loginSchema,
				response: { 200: authResponseSchema, 401: errorResponseSchema },
			},
		},
		async (request, reply) => {
			const { email, password } = request.body;
			const user = await users.findByEmail(email);
			if (!user) {
				// Compare against a dummy hash so a missing account is not measurably
				// faster than a wrong password (avoids timing-based user enumeration).
				await verifyPassword(password, await dummyPasswordHash());
				throw app.httpErrors.unauthorized('Invalid email or password');
			}
			if (!(await verifyPassword(password, user.passwordHash))) {
				throw app.httpErrors.unauthorized('Invalid email or password');
			}
			const membership = await memberships.findByUserId(user.id);
			const account = membership ? await accounts.findById(membership.accountId) : null;
			if (!membership || !account) {
				throw app.httpErrors.unauthorized('Invalid email or password');
			}
			const token = await reply.jwtSign({
				sub: user.id,
				email: user.email,
				accountId: account.id,
				role: membership.role,
			});
			return reply.send({
				token,
				user: toPublicUser(user),
				account: toPublicAccount(account),
				role: membership.role,
			});
		},
	);

	app.get(
		'/me',
		{
			onRequest: [fastify.authenticate],
			schema: {
				tags: ['auth'],
				summary: 'Return the current user, account, and role',
				security: [{ bearerAuth: [] }],
				response: { 200: sessionResponseSchema, 401: errorResponseSchema },
			},
		},
		async (request) => {
			const user = await users.findById(request.user.sub as UserId);
			const account = await accounts.findById(request.user.accountId as AccountId);
			if (!user || !account) {
				throw app.httpErrors.unauthorized('Account no longer exists');
			}
			return {
				user: toPublicUser(user),
				account: toPublicAccount(account),
				role: request.user.role,
			};
		},
	);

	app.post(
		'/accept-invite',
		{
			schema: {
				tags: ['auth'],
				summary: 'Accept an invitation and join an account',
				body: acceptInviteSchema,
				response: {
					201: authResponseSchema,
					400: errorResponseSchema,
					401: errorResponseSchema,
					409: errorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const { token: inviteToken, password } = request.body;
			const invite = await invites.findByToken(inviteToken);
			if (invite?.status !== 'pending') {
				throw app.httpErrors.unauthorized('Invalid or expired invitation');
			}
			const account = await accounts.findById(invite.accountId);
			if (!account) {
				throw app.httpErrors.unauthorized('Invalid or expired invitation');
			}
			const passwordHash = await hashPassword(password);
			// Throws ConflictError (409) if the email was claimed since the invite.
			const user = await users.create({ email: invite.email, name: invite.name, passwordHash });
			const membership = await memberships.create({
				accountId: account.id,
				userId: user.id,
				role: invite.role,
			});
			await invites.markAccepted(invite.id);
			const token = await reply.jwtSign({
				sub: user.id,
				email: user.email,
				accountId: account.id,
				role: membership.role,
			});
			return reply.code(201).send({
				token,
				user: toPublicUser(user),
				account: toPublicAccount(account),
				role: membership.role,
			});
		},
	);
};

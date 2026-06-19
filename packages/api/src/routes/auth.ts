import { loginSchema, registerSchema, type UserId } from '@rivus/core';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authResponseSchema, errorResponseSchema, userResponseSchema } from '../http-schemas';
import { toPublicUser } from '../presenters';
import { dummyPasswordHash, hashPassword, verifyPassword } from '../services/password';

export const authRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();
	const { users } = app.deps;

	app.post(
		'/register',
		{
			schema: {
				tags: ['auth'],
				summary: 'Register a new account',
				body: registerSchema,
				response: {
					201: authResponseSchema,
					400: errorResponseSchema,
					409: errorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const { email, password, name } = request.body;
			// The repository enforces email uniqueness atomically and throws a
			// ConflictError (mapped to 409) — no check-then-act race.
			const passwordHash = await hashPassword(password);
			const user = await users.create({ email, name, passwordHash });
			const token = await reply.jwtSign({ sub: user.id, email: user.email });
			return reply.code(201).send({ token, user: toPublicUser(user) });
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
			const token = await reply.jwtSign({ sub: user.id, email: user.email });
			return reply.send({ token, user: toPublicUser(user) });
		},
	);

	app.get(
		'/me',
		{
			onRequest: [fastify.authenticate],
			schema: {
				tags: ['auth'],
				summary: 'Return the currently authenticated user',
				security: [{ bearerAuth: [] }],
				response: { 200: userResponseSchema, 401: errorResponseSchema },
			},
		},
		async (request) => {
			const user = await users.findById(request.user.sub as UserId);
			if (!user) {
				throw app.httpErrors.unauthorized('Account no longer exists');
			}
			return toPublicUser(user);
		},
	);
};

import { publicCustomerSignupSchema } from '@rivus/core';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
	errorResponseSchema,
	publicAccountResponseSchema,
	publicCustomerSignupResponseSchema,
} from '../http-schemas';

/**
 * Unauthenticated endpoints backing the website's public "join as a customer"
 * view — the page the scheduling agent links an unrecognized sender to. No
 * session exists on either call by design: the visitor isn't a Rivus user,
 * they're a customer of a Rivus account. Everything else about an account
 * stays behind auth; these expose only the name needed to render the form and
 * an intentionally opaque signup acknowledgement.
 */

const slugParamsSchema = z.object({
	slug: z.string().min(1, { error: 'Account is required.' }),
});

export const publicRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();
	const { accounts, customers } = app.deps;

	app.get(
		'/accounts/:slug',
		{
			schema: {
				tags: ['public'],
				summary: 'Look up an account for the customer self-signup page',
				params: slugParamsSchema,
				response: { 200: publicAccountResponseSchema, 404: errorResponseSchema },
			},
		},
		async (request) => {
			const account = await accounts.findBySlug(request.params.slug);
			if (!account || account.status === 'canceled') {
				throw app.httpErrors.notFound('Business not found');
			}
			return { name: account.name, slug: account.slug };
		},
	);

	app.post(
		'/accounts/:slug/customers',
		{
			schema: {
				tags: ['public'],
				summary: 'Add yourself as a customer of an account',
				description:
					'Backs the self-signup view the scheduling agent links unrecognized ' +
					'senders to. Idempotent by email: if the address already belongs to one ' +
					'of the account’s customers the call succeeds without creating a ' +
					'duplicate — and without revealing that the record already existed.',
				params: slugParamsSchema,
				body: publicCustomerSignupSchema,
				response: {
					201: publicCustomerSignupResponseSchema,
					400: errorResponseSchema,
					404: errorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const account = await accounts.findBySlug(request.params.slug);
			if (!account || account.status === 'canceled') {
				throw app.httpErrors.notFound('Business not found');
			}
			const existing = await customers.findByEmail(account.id, request.body.email);
			if (!existing) {
				await customers.create(account.id, {
					name: request.body.name,
					email: request.body.email,
					phone: request.body.phone,
					address: request.body.address,
					lifetimeValue: 0,
					balance: 0,
					notes: 'Added via self-signup.',
				});
			}
			return reply.code(201).send({ status: 'registered' as const });
		},
	);
};

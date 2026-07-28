import { buildPaginationMeta, createDemoLeadSchema, paginationQuerySchema } from '@rivus/core';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
	demoLeadListResponseSchema,
	demoLeadReceivedResponseSchema,
	errorResponseSchema,
} from '../http-schemas';

/**
 * Sales leads from the marketing site. The POST is deliberately public — the
 * /demo form (and later the apps waitlist) is filled in by visitors with no
 * account — and answers with an opaque receipt, mirroring the customer
 * self-signup route. Reading leads back is Rivus-staff only.
 */
export const leadRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();
	const { demoLeads } = app.deps;

	app.post(
		'/demo',
		{
			schema: {
				tags: ['leads'],
				summary: 'Request a demo (public)',
				description:
					'Backs the marketing site’s demo-request form. Unauthenticated by design; ' +
					'the response is an opaque receipt so the endpoint reveals nothing about ' +
					'stored leads.',
				body: createDemoLeadSchema,
				response: { 201: demoLeadReceivedResponseSchema, 400: errorResponseSchema },
			},
		},
		async (request, reply) => {
			await demoLeads.create(request.body);
			return reply.code(201).send({ status: 'received' as const });
		},
	);

	app.get(
		'/demo',
		{
			onRequest: [fastify.authenticate, fastify.requireStaff],
			schema: {
				tags: ['leads'],
				summary: 'List demo requests and waitlist signups (Rivus staff only)',
				security: [{ bearerAuth: [] }],
				querystring: paginationQuerySchema,
				response: {
					200: demoLeadListResponseSchema,
					401: errorResponseSchema,
					403: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const { page, pageSize } = request.query;
			const { leads, total } = await demoLeads.list({ page, pageSize });
			return { data: leads, meta: buildPaginationMeta({ page, pageSize, total }) };
		},
	);
};

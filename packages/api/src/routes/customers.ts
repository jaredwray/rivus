import {
	type AccountId,
	buildPaginationMeta,
	type CustomerId,
	createCustomerSchema,
	paginationQuerySchema,
	updateCustomerSchema,
} from '@rivus/core';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
	customerListResponseSchema,
	customerResponseSchema,
	errorResponseSchema,
	idParamsSchema,
} from '../http-schemas';

export const customerRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();
	const { customers } = app.deps;

	// Every customer route requires a valid JWT.
	app.addHook('onRequest', fastify.authenticate);

	app.get(
		'/',
		{
			schema: {
				tags: ['customers'],
				summary: "List your account's customers",
				security: [{ bearerAuth: [] }],
				querystring: paginationQuerySchema,
				response: { 200: customerListResponseSchema, 401: errorResponseSchema },
			},
		},
		async (request) => {
			const accountId = request.user.accountId as AccountId;
			const { page, pageSize } = request.query;
			const { customers: data, total } = await customers.list({ accountId, page, pageSize });
			return { data, meta: buildPaginationMeta({ page, pageSize, total }) };
		},
	);

	app.post(
		'/',
		{
			schema: {
				tags: ['customers'],
				summary: 'Create a customer',
				security: [{ bearerAuth: [] }],
				body: createCustomerSchema,
				response: {
					201: customerResponseSchema,
					400: errorResponseSchema,
					401: errorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const customer = await customers.create(request.user.accountId as AccountId, request.body);
			return reply.code(201).send(customer);
		},
	);

	app.get(
		'/:id',
		{
			schema: {
				tags: ['customers'],
				summary: 'Fetch one of your customers',
				security: [{ bearerAuth: [] }],
				params: idParamsSchema,
				response: {
					200: customerResponseSchema,
					404: errorResponseSchema,
					401: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const customer = await customers.findById(
				request.user.accountId as AccountId,
				request.params.id as CustomerId,
			);
			if (!customer) {
				throw app.httpErrors.notFound('Customer not found');
			}
			return customer;
		},
	);

	app.patch(
		'/:id',
		{
			schema: {
				tags: ['customers'],
				summary: 'Update one of your customers',
				security: [{ bearerAuth: [] }],
				params: idParamsSchema,
				body: updateCustomerSchema,
				response: {
					200: customerResponseSchema,
					400: errorResponseSchema,
					404: errorResponseSchema,
					401: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const customer = await customers.update(
				request.user.accountId as AccountId,
				request.params.id as CustomerId,
				request.body,
			);
			if (!customer) {
				throw app.httpErrors.notFound('Customer not found');
			}
			return customer;
		},
	);

	app.delete(
		'/:id',
		{
			schema: {
				tags: ['customers'],
				summary: 'Delete one of your customers',
				security: [{ bearerAuth: [] }],
				params: idParamsSchema,
				response: {
					204: z.null(),
					401: errorResponseSchema,
					404: errorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const deleted = await customers.delete(
				request.user.accountId as AccountId,
				request.params.id as CustomerId,
			);
			if (!deleted) {
				throw app.httpErrors.notFound('Customer not found');
			}
			return reply.code(204).send(null);
		},
	);
};

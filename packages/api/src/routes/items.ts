import {
	buildPaginationMeta,
	createItemSchema,
	type ItemId,
	paginationQuerySchema,
	type UserId,
	updateItemSchema,
} from '@rivus/core';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
	errorResponseSchema,
	idParamsSchema,
	itemListResponseSchema,
	itemResponseSchema,
} from '../http-schemas';

export const itemRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();
	const { items } = app.deps;

	// Every item route requires a valid JWT.
	app.addHook('onRequest', fastify.authenticate);

	app.get(
		'/',
		{
			schema: {
				tags: ['items'],
				summary: 'List your items',
				security: [{ bearerAuth: [] }],
				querystring: paginationQuerySchema,
				response: { 200: itemListResponseSchema, 401: errorResponseSchema },
			},
		},
		async (request) => {
			const ownerId = request.user.sub as UserId;
			const { page, pageSize } = request.query;
			const { items: data, total } = await items.list({ ownerId, page, pageSize });
			return { data, meta: buildPaginationMeta({ page, pageSize, total }) };
		},
	);

	app.post(
		'/',
		{
			schema: {
				tags: ['items'],
				summary: 'Create an item',
				security: [{ bearerAuth: [] }],
				body: createItemSchema,
				response: { 201: itemResponseSchema, 400: errorResponseSchema, 401: errorResponseSchema },
			},
		},
		async (request, reply) => {
			const item = await items.create(request.user.sub as UserId, request.body);
			return reply.code(201).send(item);
		},
	);

	app.get(
		'/:id',
		{
			schema: {
				tags: ['items'],
				summary: 'Fetch one of your items',
				security: [{ bearerAuth: [] }],
				params: idParamsSchema,
				response: { 200: itemResponseSchema, 404: errorResponseSchema, 401: errorResponseSchema },
			},
		},
		async (request) => {
			const item = await items.findById(request.user.sub as UserId, request.params.id as ItemId);
			if (!item) {
				throw app.httpErrors.notFound('Item not found');
			}
			return item;
		},
	);

	app.patch(
		'/:id',
		{
			schema: {
				tags: ['items'],
				summary: 'Update one of your items',
				security: [{ bearerAuth: [] }],
				params: idParamsSchema,
				body: updateItemSchema,
				response: {
					200: itemResponseSchema,
					400: errorResponseSchema,
					404: errorResponseSchema,
					401: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const item = await items.update(
				request.user.sub as UserId,
				request.params.id as ItemId,
				request.body,
			);
			if (!item) {
				throw app.httpErrors.notFound('Item not found');
			}
			return item;
		},
	);

	app.delete(
		'/:id',
		{
			schema: {
				tags: ['items'],
				summary: 'Delete one of your items',
				security: [{ bearerAuth: [] }],
				params: idParamsSchema,
			},
		},
		async (request, reply) => {
			const deleted = await items.delete(request.user.sub as UserId, request.params.id as ItemId);
			if (!deleted) {
				throw app.httpErrors.notFound('Item not found');
			}
			return reply.code(204).send();
		},
	);
};

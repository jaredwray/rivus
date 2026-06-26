import {
	type AccountId,
	buildPaginationMeta,
	createFaqSchema,
	type FaqId,
	paginationQuerySchema,
	updateFaqSchema,
} from '@rivus/core';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
	errorResponseSchema,
	faqListResponseSchema,
	faqResponseSchema,
	idParamsSchema,
} from '../http-schemas';

export const faqRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();
	const { faqs } = app.deps;

	// Every FAQ route requires a valid JWT.
	app.addHook('onRequest', fastify.authenticate);

	app.get(
		'/',
		{
			schema: {
				tags: ['faqs'],
				summary: "List your account's FAQs",
				security: [{ bearerAuth: [] }],
				querystring: paginationQuerySchema,
				response: { 200: faqListResponseSchema, 401: errorResponseSchema },
			},
		},
		async (request) => {
			const accountId = request.user.accountId as AccountId;
			const { page, pageSize } = request.query;
			const { faqs: data, total } = await faqs.list({ accountId, page, pageSize });
			return { data, meta: buildPaginationMeta({ page, pageSize, total }) };
		},
	);

	app.post(
		'/',
		{
			schema: {
				tags: ['faqs'],
				summary: 'Create an FAQ',
				security: [{ bearerAuth: [] }],
				body: createFaqSchema,
				response: { 201: faqResponseSchema, 400: errorResponseSchema, 401: errorResponseSchema },
			},
		},
		async (request, reply) => {
			const faq = await faqs.create(request.user.accountId as AccountId, request.body);
			return reply.code(201).send(faq);
		},
	);

	app.get(
		'/:id',
		{
			schema: {
				tags: ['faqs'],
				summary: 'Fetch one of your FAQs',
				security: [{ bearerAuth: [] }],
				params: idParamsSchema,
				response: { 200: faqResponseSchema, 404: errorResponseSchema, 401: errorResponseSchema },
			},
		},
		async (request) => {
			const faq = await faqs.findById(
				request.user.accountId as AccountId,
				request.params.id as FaqId,
			);
			if (!faq) {
				throw app.httpErrors.notFound('FAQ not found');
			}
			return faq;
		},
	);

	app.patch(
		'/:id',
		{
			schema: {
				tags: ['faqs'],
				summary: 'Update one of your FAQs',
				security: [{ bearerAuth: [] }],
				params: idParamsSchema,
				body: updateFaqSchema,
				response: {
					200: faqResponseSchema,
					400: errorResponseSchema,
					404: errorResponseSchema,
					401: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const faq = await faqs.update(
				request.user.accountId as AccountId,
				request.params.id as FaqId,
				request.body,
			);
			if (!faq) {
				throw app.httpErrors.notFound('FAQ not found');
			}
			return faq;
		},
	);

	app.delete(
		'/:id',
		{
			schema: {
				tags: ['faqs'],
				summary: 'Delete one of your FAQs',
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
			const deleted = await faqs.delete(
				request.user.accountId as AccountId,
				request.params.id as FaqId,
			);
			if (!deleted) {
				throw app.httpErrors.notFound('FAQ not found');
			}
			return reply.code(204).send(null);
		},
	);
};

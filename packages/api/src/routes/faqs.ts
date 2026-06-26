import {
	type AccountId,
	buildPaginationMeta,
	createFaqSchema,
	type Faq,
	type FaqId,
	faqSimilarityQuerySchema,
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
	faqSimilarityResponseSchema,
	idParamsSchema,
} from '../http-schemas';

/** Cap how many of the account's FAQs we feed the duplicate check. */
const SIMILARITY_CANDIDATE_LIMIT = 200;

export const faqRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();
	const { faqs, faqSimilarity } = app.deps;

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

	// Registered before `/:id` so the literal path isn't shadowed by the param route.
	app.post(
		'/similar',
		{
			schema: {
				tags: ['faqs'],
				summary: 'Check whether a similar FAQ already exists (AI-assisted)',
				security: [{ bearerAuth: [] }],
				body: faqSimilarityQuerySchema,
				response: {
					200: faqSimilarityResponseSchema,
					400: errorResponseSchema,
					401: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const accountId = request.user.accountId as AccountId;
			const { question, answer } = request.body;

			// Gather the account's FAQs as candidates (paging the 100-capped list),
			// bounded so the prompt stays small.
			const candidates: Faq[] = [];
			let page = 1;
			while (candidates.length < SIMILARITY_CANDIDATE_LIMIT) {
				const { faqs: data, total } = await faqs.list({ accountId, page, pageSize: 100 });
				candidates.push(...data);
				if (data.length === 0 || candidates.length >= total) {
					break;
				}
				page += 1;
			}

			const match = await faqSimilarity.findSimilar({ question, answer }, candidates);
			if (!match) {
				return { match: null, reason: '', merged: null };
			}
			// Re-resolve the id against this account as a final guard before returning.
			const existing = await faqs.findById(accountId, match.faqId);
			if (!existing) {
				return { match: null, reason: '', merged: null };
			}
			const merged = await faqSimilarity.mergeSuggestion({ question, answer }, existing);
			return { match: existing, reason: match.reason, merged };
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

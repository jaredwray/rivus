import {
	type AccountId,
	buildPaginationMeta,
	createFaqSchema,
	type FaqId,
	faqAnswerQuerySchema,
	faqSimilarityQuerySchema,
	paginationQuerySchema,
	updateFaqSchema,
} from '@rivus/core';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
	errorResponseSchema,
	faqAnswerResponseSchema,
	faqListResponseSchema,
	faqResponseSchema,
	faqSimilarityResponseSchema,
	idParamsSchema,
} from '../http-schemas';

// Matches the service's own candidate cap and the list is newest-first, so a
// single page covers exactly what the duplicate check will consider — fetching
// more would only load rows the service discards.
const SIMILARITY_CANDIDATE_LIMIT = 50;
// The newest page of FAQs handed to the answering service as the knowledge base.
// Its own cap is smaller, but a full page keeps the candidate set newest-first and
// complete for a small business.
const ANSWER_CANDIDATE_LIMIT = 100;

export const faqRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();
	const { faqs, faqSimilarity, faqAnswer } = app.deps;

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

			// The newest page of FAQs is the candidate set the duplicate check scores.
			const { faqs: candidates } = await faqs.list({
				accountId,
				page: 1,
				pageSize: SIMILARITY_CANDIDATE_LIMIT,
			});

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

	// Registered before `/:id` so the literal path isn't shadowed by the param route.
	app.post(
		'/answer',
		{
			schema: {
				tags: ['faqs'],
				summary: 'Answer a question from the knowledge base (AI-assisted)',
				security: [{ bearerAuth: [] }],
				body: faqAnswerQuerySchema,
				response: {
					200: faqAnswerResponseSchema,
					400: errorResponseSchema,
					401: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const accountId = request.user.accountId as AccountId;
			const { question } = request.body;

			// The newest page of FAQs is the knowledge base the answer is grounded in.
			const { faqs: candidates } = await faqs.list({
				accountId,
				page: 1,
				pageSize: ANSWER_CANDIDATE_LIMIT,
			});

			const result = await faqAnswer.answer({ question }, candidates);
			// Resolve the cited ids back to questions for the response, scoped to this
			// account's candidates — a final guard against a stray id leaking through.
			const byId = new Map(candidates.map((faq) => [faq.id, faq]));
			const sources = result.sources
				.map((id) => byId.get(id))
				.filter((faq): faq is (typeof candidates)[number] => faq !== undefined)
				.map((faq) => ({ id: faq.id, question: faq.question }));
			return { answered: result.answered, answer: result.answer, sources };
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

import {
	type AccountId,
	approveReplySchema,
	buildPaginationMeta,
	type ConversationDetail,
	type ConversationId,
	type CustomerId,
	conversationListQuerySchema,
	createConversationSchema,
	sendMessageSchema,
	type UserId,
	updateConversationSchema,
} from '@rivus/core';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
	conversationDetailResponseSchema,
	conversationListResponseSchema,
	conversationResponseSchema,
	errorResponseSchema,
	idParamsSchema,
	needsAttentionCountResponseSchema,
} from '../http-schemas';
import { awaitingRivusReply, decideRivusReply, latestCustomerMessage } from '../services/inbox';

// The newest page of FAQs handed to Rivus as the knowledge base when drafting a
// reply — mirrors the FAQ "answer" route. The answer service caps its own input,
// so a full page keeps the candidate set newest-first and complete for a small
// business.
const ANSWER_CANDIDATE_LIMIT = 100;

/**
 * A conversation may name a CRM customer by id. Persisting one that points at a
 * customer outside this account would dangle a reference the context panel can
 * never resolve, so validate any non-empty id before the write. An empty id
 * ("a lead, no customer record yet") is fine.
 */
async function assertCustomerExists(
	app: FastifyInstance,
	accountId: AccountId,
	customerId: string | undefined,
): Promise<void> {
	if (customerId) {
		const customer = await app.deps.customers.findById(accountId, customerId as CustomerId);
		if (!customer) {
			throw app.httpErrors.badRequest('That customer does not exist in this account.');
		}
	}
}

export const conversationRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();
	const { conversations, faqs, faqAnswer, memberships, notifier } = app.deps;

	// Every conversation route requires a valid JWT.
	app.addHook('onRequest', fastify.authenticate);

	/** Load a conversation with its transcript, or null when it isn't the account's. */
	async function loadDetail(
		accountId: AccountId,
		id: ConversationId,
	): Promise<ConversationDetail | null> {
		const conversation = await conversations.findById(accountId, id);
		if (!conversation) {
			return null;
		}
		const messages = (await conversations.listMessages(accountId, id)) ?? [];
		return { conversation, messages };
	}

	app.get(
		'/',
		{
			schema: {
				tags: ['conversations'],
				summary: "List your account's conversations (the inbox)",
				security: [{ bearerAuth: [] }],
				querystring: conversationListQuerySchema,
				response: {
					200: conversationListResponseSchema,
					400: errorResponseSchema,
					401: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const accountId = request.user.accountId as AccountId;
			const { page, pageSize, status } = request.query;
			const { conversations: data, total } = await conversations.list({
				accountId,
				page,
				pageSize,
				status,
			});
			return { data, meta: buildPaginationMeta({ page, pageSize, total }) };
		},
	);

	app.post(
		'/',
		{
			schema: {
				tags: ['conversations'],
				summary: 'Open a conversation',
				security: [{ bearerAuth: [] }],
				body: createConversationSchema,
				response: {
					201: conversationResponseSchema,
					400: errorResponseSchema,
					401: errorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const accountId = request.user.accountId as AccountId;
			await assertCustomerExists(app, accountId, request.body.customerId);
			const conversation = await conversations.create(accountId, request.body);
			return reply.code(201).send(conversation);
		},
	);

	// Registered before `/:id` so the literal path isn't shadowed by the param route.
	app.get(
		'/needs-attention-count',
		{
			schema: {
				tags: ['conversations'],
				summary: 'Count conversations that need a human (for the Inbox badge)',
				security: [{ bearerAuth: [] }],
				response: { 200: needsAttentionCountResponseSchema, 401: errorResponseSchema },
			},
		},
		async (request) => {
			const count = await conversations.needsAttentionCount(request.user.accountId as AccountId);
			return { count };
		},
	);

	app.get(
		'/:id',
		{
			schema: {
				tags: ['conversations'],
				summary: 'Fetch one conversation with its full transcript',
				security: [{ bearerAuth: [] }],
				params: idParamsSchema,
				response: {
					200: conversationDetailResponseSchema,
					404: errorResponseSchema,
					401: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const detail = await loadDetail(
				request.user.accountId as AccountId,
				request.params.id as ConversationId,
			);
			if (!detail) {
				throw app.httpErrors.notFound('Conversation not found');
			}
			return detail;
		},
	);

	app.patch(
		'/:id',
		{
			schema: {
				tags: ['conversations'],
				summary: 'Update a conversation (tags, status, contact, …)',
				security: [{ bearerAuth: [] }],
				params: idParamsSchema,
				body: updateConversationSchema,
				response: {
					200: conversationResponseSchema,
					400: errorResponseSchema,
					404: errorResponseSchema,
					401: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const accountId = request.user.accountId as AccountId;
			await assertCustomerExists(app, accountId, request.body.customerId);
			const conversation = await conversations.update(
				accountId,
				request.params.id as ConversationId,
				request.body,
			);
			if (!conversation) {
				throw app.httpErrors.notFound('Conversation not found');
			}
			return conversation;
		},
	);

	app.delete(
		'/:id',
		{
			schema: {
				tags: ['conversations'],
				summary: 'Delete a conversation',
				security: [{ bearerAuth: [] }],
				params: idParamsSchema,
				response: { 204: z.null(), 401: errorResponseSchema, 404: errorResponseSchema },
			},
		},
		async (request, reply) => {
			const deleted = await conversations.delete(
				request.user.accountId as AccountId,
				request.params.id as ConversationId,
			);
			if (!deleted) {
				throw app.httpErrors.notFound('Conversation not found');
			}
			return reply.code(204).send(null);
		},
	);

	app.post(
		'/:id/messages',
		{
			schema: {
				tags: ['conversations'],
				summary: 'Send a reply as a team member',
				security: [{ bearerAuth: [] }],
				params: idParamsSchema,
				body: sendMessageSchema,
				response: {
					201: conversationDetailResponseSchema,
					400: errorResponseSchema,
					404: errorResponseSchema,
					401: errorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const accountId = request.user.accountId as AccountId;
			const id = request.params.id as ConversationId;
			// Capture the prior status: a human reply means a flagged thread no longer
			// needs attention, so we clear the held draft afterward.
			const before = await conversations.findById(accountId, id);
			if (!before) {
				throw app.httpErrors.notFound('Conversation not found');
			}
			const detail = await conversations.addMessage(accountId, id, {
				author: 'agent',
				body: request.body.body,
			});
			if (!detail) {
				throw app.httpErrors.notFound('Conversation not found');
			}
			if (before.status === 'needs_attention') {
				const cleared = await conversations.setReviewState(accountId, id, {
					status: 'rivus_handling',
					pendingReply: '',
					flagReason: '',
				});
				if (cleared) {
					detail.conversation = cleared;
				}
			}
			return reply.code(201).send(detail);
		},
	);

	app.post(
		'/:id/reply',
		{
			schema: {
				tags: ['conversations'],
				summary: 'Let Rivus draft a reply from the knowledge base',
				description:
					'Rivus answers the latest customer message from the account’s published FAQs. ' +
					'An everyday answer is sent immediately; a money/billing question (or one the ' +
					'knowledge base can’t answer) is held as a draft and the thread is flagged for review.',
				security: [{ bearerAuth: [] }],
				params: idParamsSchema,
				response: {
					200: conversationDetailResponseSchema,
					404: errorResponseSchema,
					409: errorResponseSchema,
					401: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const accountId = request.user.accountId as AccountId;
			const id = request.params.id as ConversationId;
			const conversation = await conversations.findById(accountId, id);
			if (!conversation) {
				throw app.httpErrors.notFound('Conversation not found');
			}
			// A thread already held for review is waiting on a human, not on Rivus.
			if (conversation.status === 'needs_attention') {
				throw app.httpErrors.conflict('This conversation is already waiting for your review.');
			}
			const messages = (await conversations.listMessages(accountId, id)) ?? [];
			const question = latestCustomerMessage(messages);
			if (question === null) {
				throw app.httpErrors.conflict('There is no customer message for Rivus to reply to.');
			}
			// Idempotency: don't append a second answer if the latest customer turn has
			// already been replied to (a double-tap, a retry, or two members at once).
			if (!awaitingRivusReply(messages)) {
				throw app.httpErrors.conflict('The latest message has already been answered.');
			}

			// Ground the draft in the account's published FAQs (drafts are staged, never
			// customer-facing), exactly like the FAQ "answer" endpoint.
			const { faqs: page } = await faqs.list({
				accountId,
				page: 1,
				pageSize: ANSWER_CANDIDATE_LIMIT,
			});
			const candidates = page.filter((faq) => faq.status === 'published');
			const answer = await faqAnswer.answer({ question }, candidates);
			const decision = decideRivusReply({ customerMessage: question, answer });

			if (!decision.pause) {
				// Confident, everyday answer: Rivus sends it and keeps handling the thread.
				const detail = await conversations.addMessage(accountId, id, {
					author: 'rivus',
					body: decision.draft,
				});
				if (!detail) {
					throw app.httpErrors.notFound('Conversation not found');
				}
				const resumed = await conversations.setReviewState(accountId, id, {
					status: 'rivus_handling',
					pendingReply: '',
					flagReason: '',
				});
				if (resumed) {
					detail.conversation = resumed;
				}
				return detail;
			}

			// Held for a human: flag the thread, stash the draft, and alert the team.
			await conversations.setReviewState(accountId, id, {
				status: 'needs_attention',
				pendingReply: decision.draft,
				flagReason: decision.reason,
			});
			const memberIds = (await memberships.listByAccount(accountId)).map(
				(membership) => membership.userId,
			);
			await notifier.conversationNeedsReview({
				accountId,
				actorId: request.user.sub as UserId,
				memberIds,
				contactName: conversation.contactName,
				logger: request.log,
			});
			const detail = await loadDetail(accountId, id);
			if (!detail) {
				throw app.httpErrors.notFound('Conversation not found');
			}
			return detail;
		},
	);

	app.post(
		'/:id/approve',
		{
			schema: {
				tags: ['conversations'],
				summary: "Approve and send Rivus's held draft (optionally edited)",
				security: [{ bearerAuth: [] }],
				params: idParamsSchema,
				body: approveReplySchema,
				response: {
					200: conversationDetailResponseSchema,
					400: errorResponseSchema,
					404: errorResponseSchema,
					409: errorResponseSchema,
					401: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const accountId = request.user.accountId as AccountId;
			const id = request.params.id as ConversationId;
			const conversation = await conversations.findById(accountId, id);
			if (!conversation) {
				throw app.httpErrors.notFound('Conversation not found');
			}
			// Approve only sends a held draft. Without this guard any member could POST
			// here on a normal thread and inject a `rivus`-authored message, bypassing the
			// `/messages` path that records human replies as `agent`.
			if (conversation.status !== 'needs_attention') {
				throw app.httpErrors.conflict('This conversation is not awaiting approval.');
			}
			// An empty body sends the held draft as-is; a non-empty body is the edited
			// version. With neither there is nothing to send.
			const finalText = request.body.body || conversation.pendingReply;
			if (finalText.trim() === '') {
				throw app.httpErrors.badRequest('There is nothing to send — write a reply first.');
			}
			const detail = await conversations.addMessage(accountId, id, {
				author: 'rivus',
				body: finalText,
			});
			if (!detail) {
				throw app.httpErrors.notFound('Conversation not found');
			}
			const resumed = await conversations.setReviewState(accountId, id, {
				status: 'rivus_handling',
				pendingReply: '',
				flagReason: '',
			});
			if (resumed) {
				detail.conversation = resumed;
			}
			return detail;
		},
	);
};

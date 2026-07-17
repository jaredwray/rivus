import {
	type Account,
	type AccountId,
	buildPaginationMeta,
	type CreateFaqInput,
	type Faq,
	type FaqId,
	type PaginationMeta,
	type UpdateFaqInput,
} from '@rivus/core';
import type { AccountRepository, FaqRepository } from '../../repositories/types';
import type { FaqAnswerService } from '../faq-answer';
import type { FaqSimilarityService } from '../faq-similarity';
import {
	answerFromKnowledge,
	type FaqSimilarityCheck,
	findSimilarFaq,
	type KnowledgeAnswer,
} from '../knowledge';

/**
 * The account-scoped operations the chat assistant can perform, executed
 * in-process against the same repositories and AI services the `/v1` routes use.
 *
 * This replaces the standalone agent's HTTP client (`@rivus/agent`'s `api.ts`) —
 * same method surface and result shapes, no network hop, no forwarded token.
 * Tenancy comes from binding an instance to the authenticated session's
 * `accountId`; the route only constructs one after the session has passed the
 * same revalidation `authenticate` applies, so every call here is as authorized
 * as the equivalent REST call was.
 */
export interface ChatActions {
	/** The signed-in user's company record. */
	me(): Promise<{ account: Account }>;
	/** A page of the account's FAQs (the knowledge base). */
	listFaqs(query?: {
		page?: number;
		pageSize?: number;
	}): Promise<{ data: Faq[]; meta: PaginationMeta }>;
	/** Apply a partial update to one FAQ. */
	updateFaq(id: FaqId, patch: UpdateFaqInput): Promise<Faq>;
	/** Create a new FAQ. */
	createFaq(input: CreateFaqInput): Promise<Faq>;
	/** Ask whether a semantically similar FAQ already exists (AI-assisted). */
	findSimilarFaq(input: { question: string; answer?: string }): Promise<FaqSimilarityCheck>;
	/** Answer a free-text question from the account's knowledge base (AI-assisted). */
	answerFromKnowledge(input: { question: string }): Promise<KnowledgeAnswer>;
}

export interface ChatActionsDeps {
	accounts: AccountRepository;
	faqs: FaqRepository;
	faqSimilarity: FaqSimilarityService;
	faqAnswer: FaqAnswerService;
}

/** Bind the chat actions to one account (the authenticated session's). */
export function createChatActions(deps: ChatActionsDeps, accountId: AccountId): ChatActions {
	return {
		async me() {
			const account = await deps.accounts.findById(accountId);
			// Session revalidation already fails closed on a missing account, so this
			// only fires on a mid-request delete; the reply layer turns it into its
			// generic "couldn't reach your data" answer.
			if (!account) {
				throw new Error(`chat: account ${accountId} no longer exists`);
			}
			return { account };
		},

		async listFaqs(query) {
			const page = query?.page ?? 1;
			const pageSize = query?.pageSize ?? 20;
			const { faqs: data, total } = await deps.faqs.list({ accountId, page, pageSize });
			return { data, meta: buildPaginationMeta({ page, pageSize, total }) };
		},

		async updateFaq(id, patch) {
			const updated = await deps.faqs.update(accountId, id, patch);
			// The assistant only updates FAQs it just scanned, so a miss is a race
			// (deleted underneath us) and surfaces as the generic failure reply.
			if (!updated) {
				throw new Error(`chat: FAQ ${id} not found for update`);
			}
			return updated;
		},

		createFaq(input) {
			return deps.faqs.create(accountId, input);
		},

		findSimilarFaq(input) {
			return findSimilarFaq(deps, accountId, {
				question: input.question,
				answer: input.answer ?? '',
			});
		},

		answerFromKnowledge(input) {
			return answerFromKnowledge(deps, accountId, input.question);
		},
	};
}

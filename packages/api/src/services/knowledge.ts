import type { AccountId, Faq, FaqId } from '@rivus/core';
import type { FaqRepository } from '../repositories/types';
import type { FaqAnswerGrounding, FaqAnswerService } from './faq-answer';
import type { FaqMergeSuggestion, FaqSimilarityService } from './faq-similarity';

/**
 * Account-scoped knowledge-base operations shared by the FAQ routes and the chat
 * assistant. Each one owns its candidate-set policy (how much of the knowledge
 * base the AI service sees), so the two callers can never drift apart on it.
 */

// Matches the similarity service's own candidate cap and the list is newest-first,
// so a single page covers exactly what the duplicate check will consider —
// fetching more would only load rows the service discards.
const SIMILARITY_CANDIDATE_LIMIT = 50;
// The newest page of FAQs handed to the answering service as the knowledge base.
// Its own cap is smaller, but a full page keeps the candidate set newest-first and
// complete for a small business.
const ANSWER_CANDIDATE_LIMIT = 100;

export interface FaqSimilarityCheck {
	match: Faq | null;
	reason: string;
	merged: FaqMergeSuggestion | null;
}

/**
 * Check whether the account already has an FAQ semantically similar to `input`.
 * Returns the existing FAQ plus an AI-merged suggestion, or `{ match: null }`
 * when nothing similar is found (or no AI provider is configured).
 */
export async function findSimilarFaq(
	deps: { faqs: FaqRepository; faqSimilarity: FaqSimilarityService },
	accountId: AccountId,
	input: { question: string; answer: string },
): Promise<FaqSimilarityCheck> {
	// The newest page of FAQs is the candidate set the duplicate check scores.
	const { faqs: candidates } = await deps.faqs.list({
		accountId,
		page: 1,
		pageSize: SIMILARITY_CANDIDATE_LIMIT,
	});

	const match = await deps.faqSimilarity.findSimilar(input, candidates);
	if (!match) {
		return { match: null, reason: '', merged: null };
	}
	// Re-resolve the id against this account as a final guard before returning.
	const existing = await deps.faqs.findById(accountId, match.faqId);
	if (!existing) {
		return { match: null, reason: '', merged: null };
	}
	const merged = await deps.faqSimilarity.mergeSuggestion(input, existing);
	return { match: existing, reason: match.reason, merged };
}

export interface KnowledgeAnswer {
	answered: boolean;
	answer: string;
	sources: Array<{ id: FaqId; question: string }>;
	/** Whether a model wrote the answer or the deterministic keyword matcher did. */
	grounding: FaqAnswerGrounding;
}

/**
 * Answer a free-text question from the account's knowledge base (AI-assisted).
 * Only published FAQs are considered — drafts are staged and not yet live, so an
 * answer must never be grounded in (or cite) draft content. Returns
 * `{ answered: false }` when the knowledge base doesn't cover the question.
 */
export async function answerFromKnowledge(
	deps: { faqs: FaqRepository; faqAnswer: FaqAnswerService },
	accountId: AccountId,
	question: string,
): Promise<KnowledgeAnswer> {
	// The newest page of FAQs is the knowledge base the answer is grounded in.
	const { faqs: page } = await deps.faqs.list({
		accountId,
		page: 1,
		pageSize: ANSWER_CANDIDATE_LIMIT,
	});
	const candidates = page.filter((faq) => faq.status === 'published');

	const result = await deps.faqAnswer.answer({ question }, candidates);
	// Resolve the cited ids back to questions for the caller, scoped to this
	// account's candidates — a final guard against a stray id leaking through.
	const byId = new Map(candidates.map((faq) => [faq.id, faq]));
	const sources = result.sources
		.map((id) => byId.get(id))
		.filter((faq): faq is (typeof candidates)[number] => faq !== undefined)
		.map((faq) => ({ id: faq.id, question: faq.question }));
	return {
		answered: result.answered,
		answer: result.answer,
		sources,
		grounding: result.grounding,
	};
}

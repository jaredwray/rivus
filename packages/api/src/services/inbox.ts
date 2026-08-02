import type { Message } from '@rivus/core';
import type { FaqAnswer } from './faq-answer';

/**
 * Pure inbox policy: how Rivus turns a knowledge-base answer into either a sent
 * reply or a held draft for a human. Kept free of I/O so it's exhaustively
 * unit-tested; the conversations route wires it to the live FAQ-answer service.
 */

/** Shown in the approve banner for a money/billing thread (mirrors the mock copy). */
export const BILLING_PAUSE_REASON =
	'This reply touches a billing dispute — approve it or edit before it sends.';

/** Shown when Rivus has no grounded answer and wants a human to take the thread. */
export const UNSURE_PAUSE_REASON =
	"Rivus wasn't sure how to answer this one — review and reply before it sends.";

/**
 * Shown when the draft came from the deterministic keyword matcher rather than a
 * model — no provider configured, or every provider failed. That matcher returns
 * an FAQ's stored answer on as little as one shared word, so the draft is a
 * decent suggestion for a human and not something to send unreviewed.
 */
export const KEYWORD_DRAFT_PAUSE_REASON =
	'Rivus drafted this from the closest FAQ while its AI answering was unavailable — review before it sends.';

/**
 * Shown when an email Rivus sent bounced or was marked as spam, so a human
 * reaches the customer another way. Set on the agent-email conversation when a
 * Resend delivery-failure webhook arrives.
 */
export const DELIVERY_FAILED_REASON =
	"Rivus's last email didn't reach this customer — follow up another way.";

// Terms that mark a customer message as money/billing-sensitive, so Rivus holds
// its draft for a human even when the knowledge base could answer it. Matched as
// whole words, case-insensitively.
const BILLING_TERMS = [
	'invoice',
	'invoiced',
	'charge',
	'charged',
	'refund',
	'refunded',
	'dispute',
	'disputed',
	'overcharge',
	'overcharged',
	'bill',
	'billed',
	'billing',
	'price',
	'priced',
	'pricing',
	'quote',
	'quoted',
	'payment',
	'owe',
	'owed',
	'balance',
	'deposit',
	'receipt',
] as const;

const BILLING_PATTERN = new RegExp(`\\b(?:${BILLING_TERMS.join('|')})\\b`, 'i');

/** Whether a customer message is about money/billing (and so warrants a human check). */
export function isBillingSensitive(text: string): boolean {
	return BILLING_PATTERN.test(text);
}

/** The most recent customer turn's text, or null when the customer hasn't written. */
export function latestCustomerMessage(messages: Message[]): string | null {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		if (message?.author === 'customer') {
			return message.body;
		}
	}
	return null;
}

/**
 * Whether the newest customer turn is still awaiting a reply: scanning from the
 * end (past system `note`s), the first real message is from the customer. False
 * when Rivus or a human already answered it — so re-running `/reply` can't append
 * a duplicate answer — or when the customer hasn't written at all.
 */
export function awaitingRivusReply(messages: Message[]): boolean {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const author = messages[i]?.author;
		if (author === 'note') {
			continue;
		}
		return author === 'customer';
	}
	return false;
}

export interface RivusReplyDecision {
	/** When false, Rivus sends the draft itself; when true, it's held for approval. */
	pause: boolean;
	/** The reply text (empty only when Rivus has no grounded answer and pauses). */
	draft: string;
	/** Why Rivus paused (empty when it isn't pausing). */
	reason: string;
}

/**
 * Decide how Rivus handles a drafted reply:
 * - a model-grounded answer to an everyday question is sent immediately;
 * - a money/billing question is always held for a human, even when answered, so
 *   nobody is auto-billed by a bot;
 * - a keyword-matched draft is held too: with no model available the match can be
 *   as thin as one shared word, which is a useful suggestion for a human and a bad
 *   thing to send unprompted;
 * - a question the knowledge base can't answer is held with no draft, flagged so
 *   a human writes the reply.
 *
 * One policy, two callers: the inbox's "Let Rivus draft a reply" button and the
 * customer-facing agent both come through here, so what is safe to send can never
 * mean two different things.
 */
export function decideRivusReply(input: {
	customerMessage: string;
	answer: FaqAnswer;
}): RivusReplyDecision {
	const billing = isBillingSensitive(input.customerMessage);
	if (input.answer.answered) {
		const draft = input.answer.answer;
		if (billing) {
			return { pause: true, draft, reason: BILLING_PAUSE_REASON };
		}
		if (input.answer.grounding !== 'model') {
			return { pause: true, draft, reason: KEYWORD_DRAFT_PAUSE_REASON };
		}
		return { pause: false, draft, reason: '' };
	}
	return {
		pause: true,
		draft: '',
		reason: billing ? BILLING_PAUSE_REASON : UNSURE_PAUSE_REASON,
	};
}

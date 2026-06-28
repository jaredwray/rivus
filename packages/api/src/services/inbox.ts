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
 * - a grounded answer to an everyday question is sent immediately;
 * - a money/billing question is always held for a human, even when answered, so
 *   nobody is auto-billed by a bot;
 * - a question the knowledge base can't answer is held with no draft, flagged so
 *   a human writes the reply.
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
		return { pause: false, draft, reason: '' };
	}
	return {
		pause: true,
		draft: '',
		reason: billing ? BILLING_PAUSE_REASON : UNSURE_PAUSE_REASON,
	};
}

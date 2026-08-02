import type { ConversationId, Message, MessageId } from '@rivus/core';
import { describe, expect, it } from 'vitest';
import type { FaqAnswer } from '../src/services/faq-answer';
import {
	awaitingRivusReply,
	BILLING_PAUSE_REASON,
	decideRivusReply,
	isBillingSensitive,
	KEYWORD_DRAFT_PAUSE_REASON,
	latestCustomerMessage,
	UNSURE_PAUSE_REASON,
} from '../src/services/inbox';

function message(author: Message['author'], body: string): Message {
	return {
		id: `msg-${body}` as MessageId,
		conversationId: 'conv-1' as ConversationId,
		author,
		body,
		createdAt: '2026-06-28T12:00:00.000Z',
	};
}

const answered: FaqAnswer = {
	answered: true,
	answer: 'We are open 9–6.',
	sources: [],
	grounding: 'model',
};
const unanswered: FaqAnswer = { answered: false, answer: '', sources: [], grounding: 'model' };
/** The same answer, but written by the keyword matcher rather than a model. */
const keywordAnswered: FaqAnswer = { ...answered, grounding: 'keyword' };

describe('isBillingSensitive', () => {
	it('flags money and billing wording', () => {
		for (const text of [
			'Can you explain this invoice?',
			'I want a refund.',
			'Why was I charged twice?',
			'I am disputing the balance.',
			'What is the deposit?',
		]) {
			expect(isBillingSensitive(text)).toBe(true);
		}
	});

	it('leaves everyday questions alone', () => {
		for (const text of ['What are your hours?', 'Do you service Bellevue?', 'Thank you!']) {
			expect(isBillingSensitive(text)).toBe(false);
		}
	});

	it('matches whole words only', () => {
		// "billboard" contains "bill" but isn't about billing.
		expect(isBillingSensitive('I saw your billboard downtown')).toBe(false);
	});
});

describe('latestCustomerMessage', () => {
	it('returns the most recent customer turn', () => {
		const messages = [
			message('customer', 'first'),
			message('rivus', 'reply'),
			message('customer', 'second'),
			message('note', 'booked'),
		];
		expect(latestCustomerMessage(messages)).toBe('second');
	});

	it('returns null when the customer has not written', () => {
		expect(latestCustomerMessage([message('rivus', 'hi'), message('note', 'n')])).toBeNull();
		expect(latestCustomerMessage([])).toBeNull();
	});
});

describe('awaitingRivusReply', () => {
	it('is true when the newest real message is from the customer', () => {
		expect(awaitingRivusReply([message('customer', 'hi')])).toBe(true);
		// A trailing note doesn't count as a reply.
		expect(awaitingRivusReply([message('customer', 'hi'), message('note', 'flagged')])).toBe(true);
	});

	it('is false once Rivus or a human has replied', () => {
		expect(awaitingRivusReply([message('customer', 'hi'), message('rivus', 'answer')])).toBe(false);
		expect(awaitingRivusReply([message('customer', 'hi'), message('agent', 'on it')])).toBe(false);
	});

	it('is false when the customer has not written', () => {
		expect(awaitingRivusReply([])).toBe(false);
		expect(awaitingRivusReply([message('note', 'call transcribed')])).toBe(false);
	});
});

describe('decideRivusReply', () => {
	it('sends a grounded answer to an everyday question', () => {
		const decision = decideRivusReply({
			customerMessage: 'What are your hours?',
			answer: answered,
		});
		expect(decision).toEqual({ pause: false, draft: 'We are open 9–6.', reason: '' });
	});

	it('holds an answered billing question for review', () => {
		const decision = decideRivusReply({
			customerMessage: 'Can you explain my invoice?',
			answer: {
				answered: true,
				answer: 'The difference is a part.',
				sources: [],
				grounding: 'model',
			},
		});
		expect(decision).toEqual({
			pause: true,
			draft: 'The difference is a part.',
			reason: BILLING_PAUSE_REASON,
		});
	});

	it('holds a keyword-matched draft, keeping it for a human to approve', () => {
		// With no model available the match can be a single shared word, so the draft
		// is a suggestion — good enough to offer a human, not to send on its own.
		const decision = decideRivusReply({
			customerMessage: 'What are your hours?',
			answer: keywordAnswered,
		});
		expect(decision).toEqual({
			pause: true,
			draft: 'We are open 9–6.',
			reason: KEYWORD_DRAFT_PAUSE_REASON,
		});
	});

	it('prefers the billing reason when a keyword draft is also money-sensitive', () => {
		const decision = decideRivusReply({
			customerMessage: 'Can you explain my invoice?',
			answer: keywordAnswered,
		});
		expect(decision.pause).toBe(true);
		expect(decision.reason).toBe(BILLING_PAUSE_REASON);
	});

	it('holds an unanswerable question with no draft', () => {
		const decision = decideRivusReply({
			customerMessage: 'Do you sell gift cards?',
			answer: unanswered,
		});
		expect(decision).toEqual({ pause: true, draft: '', reason: UNSURE_PAUSE_REASON });
	});

	it('uses the billing reason for an unanswerable money question', () => {
		const decision = decideRivusReply({
			customerMessage: 'Why is my balance so high?',
			answer: unanswered,
		});
		expect(decision.pause).toBe(true);
		expect(decision.reason).toBe(BILLING_PAUSE_REASON);
		// Held with no draft — a human writes the reply.
		expect(decision.draft).toBe('');
	});
});

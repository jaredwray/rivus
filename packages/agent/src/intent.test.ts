import { describe, expect, it } from 'vitest';
import { parseIntent, resolveIntent } from './intent';
import type { ChatMessage } from './types';

const user = (content: string): ChatMessage => ({ role: 'user', content });
const assistant = (content: string): ChatMessage => ({ role: 'assistant', content });

describe('parseIntent — conversational', () => {
	it('treats an empty message as a greeting', () => {
		expect(parseIntent('')).toEqual({ kind: 'greeting' });
		expect(parseIntent('   ')).toEqual({ kind: 'greeting' });
	});

	it('recognises bare greetings', () => {
		expect(parseIntent('hi')).toEqual({ kind: 'greeting' });
		expect(parseIntent('Hello')).toEqual({ kind: 'greeting' });
		expect(parseIntent('Good morning')).toEqual({ kind: 'greeting' });
	});

	it('recognises greetings with trailing punctuation', () => {
		expect(parseIntent('hi!')).toEqual({ kind: 'greeting' });
		expect(parseIntent('Hello.')).toEqual({ kind: 'greeting' });
		expect(parseIntent('hey!!!')).toEqual({ kind: 'greeting' });
	});

	it('recognises help asks', () => {
		expect(parseIntent('help')).toEqual({ kind: 'help' });
		expect(parseIntent('What can you do?')).toEqual({ kind: 'help' });
		expect(parseIntent('how can you help me')).toEqual({ kind: 'help' });
	});

	it('falls back to unknown for an unrelated ask', () => {
		expect(parseIntent('what is the meaning of life')).toEqual({ kind: 'unknown' });
	});
});

describe('parseIntent — company info', () => {
	it('detects a single field', () => {
		expect(parseIntent('what is our website?')).toEqual({
			kind: 'company_info',
			fields: ['website'],
		});
		expect(parseIntent("what's our phone number")).toEqual({
			kind: 'company_info',
			fields: ['phone'],
		});
		expect(parseIntent('show me my address')).toEqual({
			kind: 'company_info',
			fields: ['address'],
		});
		expect(parseIntent('what time zone are we in')).toEqual({
			kind: 'company_info',
			fields: ['timezone'],
		});
	});

	it('collects multiple requested fields in a stable order', () => {
		expect(parseIntent('what are our website and phone number?')).toEqual({
			kind: 'company_info',
			fields: ['website', 'phone'],
		});
	});

	it('treats a generic company ask as "everything" (empty fields)', () => {
		expect(parseIntent('tell me about my business')).toEqual({ kind: 'company_info', fields: [] });
		expect(parseIntent('show my company info')).toEqual({ kind: 'company_info', fields: [] });
	});
});

describe('parseIntent — knowledge base', () => {
	it('lists the knowledge base for a bare reference', () => {
		expect(parseIntent('faqs')).toEqual({ kind: 'faq_list' });
		expect(parseIntent('show me the knowledge base')).toEqual({ kind: 'faq_list' });
		expect(parseIntent('list our FAQs')).toEqual({ kind: 'faq_list' });
	});

	it('extracts a search query', () => {
		expect(parseIntent('search the FAQ for refunds')).toEqual({
			kind: 'faq_search',
			query: 'refunds',
		});
		expect(parseIntent('do we have an FAQ about parking?')).toEqual({
			kind: 'faq_search',
			query: 'parking',
		});
		expect(parseIntent('find FAQs about pricing')).toEqual({
			kind: 'faq_search',
			query: 'pricing',
		});
	});

	it('parses an update with a new answer', () => {
		expect(
			parseIntent('update the FAQ about returns to say we accept returns within 30 days'),
		).toEqual({
			kind: 'faq_update',
			topic: 'returns',
			answer: 'we accept returns within 30 days',
		});
	});

	it('parses an update without an answer (topic only)', () => {
		expect(parseIntent('change the FAQ about shipping')).toEqual({
			kind: 'faq_update',
			topic: 'shipping',
			answer: null,
		});
	});

	it('keeps a multi-word topic that itself contains "to" intact', () => {
		expect(parseIntent('update the faq about how to cancel to say just email us')).toEqual({
			kind: 'faq_update',
			topic: 'how to cancel',
			answer: 'just email us',
		});
		// Bare "to" connector: split at the LAST " to ", not the first.
		expect(parseIntent('change the faq about ways to pay to credit and cash')).toEqual({
			kind: 'faq_update',
			topic: 'ways to pay',
			answer: 'credit and cash',
		});
	});

	it('asks for a topic when an update names none', () => {
		expect(parseIntent('update an FAQ')).toEqual({ kind: 'faq_update', topic: '', answer: null });
	});

	it('parses a create with an explicit question/answer', () => {
		expect(parseIntent('add an FAQ question: Do you ship? answer: Yes we do')).toEqual({
			kind: 'faq_create',
			question: 'Do you ship?',
			answer: 'Yes we do',
		});
	});

	it('parses a create with only a topic', () => {
		expect(parseIntent('create a new FAQ about warranty')).toEqual({
			kind: 'faq_create',
			question: 'warranty',
			answer: null,
		});
	});

	it('does not let a hyphenated "a" in the question hijack the answer split', () => {
		expect(parseIntent('add an FAQ question: is there a-la-carte pricing answer: yes')).toEqual({
			kind: 'faq_create',
			question: 'is there a-la-carte pricing',
			answer: 'yes',
		});
	});

	it('treats "find FAQs in our knowledge base" as a list, not a search for "knowledge base"', () => {
		expect(parseIntent('find FAQs in our knowledge base')).toEqual({ kind: 'faq_list' });
	});

	it('parses a bare create with neither part', () => {
		expect(parseIntent('add a faq')).toEqual({
			kind: 'faq_create',
			question: null,
			answer: null,
		});
	});

	it('routes a knowledge-base topic ask to search even without a search verb', () => {
		expect(parseIntent('knowledge base about onboarding')).toEqual({
			kind: 'faq_search',
			query: 'onboarding',
		});
	});
});

describe('parseIntent — natural FAQ create', () => {
	it('extracts a quoted title and a trailing-sentence answer (the reported case)', () => {
		expect(
			parseIntent('add this FAQ. "Our Cancelation Policy". It needs to be 24 hour in advance'),
		).toEqual({
			kind: 'faq_create',
			question: 'Our Cancelation Policy',
			answer: 'It needs to be 24 hour in advance',
		});
	});

	it('handles smart (curly) quotes from a phone keyboard', () => {
		expect(parseIntent('add a faq “Our Hours”. We open at 9am')).toEqual({
			kind: 'faq_create',
			question: 'Our Hours',
			answer: 'We open at 9am',
		});
	});

	it('handles German-style low-high double quotes (“„…“”)', () => {
		expect(parseIntent('add a faq „Our Hours“. We open at 9am')).toEqual({
			kind: 'faq_create',
			question: 'Our Hours',
			answer: 'We open at 9am',
		});
	});

	it('takes a quoted title alone as the question and asks for the answer next', () => {
		expect(parseIntent('add a faq "Do you deliver?"')).toEqual({
			kind: 'faq_create',
			question: 'Do you deliver?',
			answer: null,
		});
	});

	it('strips a stray "answer:" label that trails a quoted title', () => {
		expect(parseIntent('add a faq "Returns" answer: 30 days')).toEqual({
			kind: 'faq_create',
			question: 'Returns',
			answer: '30 days',
		});
	});

	it('splits a natural "<question>? <answer>" with no quotes', () => {
		expect(parseIntent('add an FAQ: do you deliver? yes, city-wide')).toEqual({
			kind: 'faq_create',
			question: 'do you deliver?',
			answer: 'yes, city-wide',
		});
	});

	it('treats a lone question (ending in ?) as the question and asks for the answer', () => {
		expect(parseIntent('add an faq: how do I cancel?')).toEqual({
			kind: 'faq_create',
			question: 'how do I cancel?',
			answer: null,
		});
	});

	it('does not mistake an apostrophe for an opening quote', () => {
		// No double-quoted title and no "?" → nothing reliable to extract, so it asks
		// for both parts rather than splitting on the apostrophe in "it's".
		expect(parseIntent("add a faq it's our policy")).toEqual({
			kind: 'faq_create',
			question: null,
			answer: null,
		});
	});

	it('does not split on a "?" that ends the request rather than the FAQ', () => {
		// The "?" closes "…to our FAQ?", so it must not be taken as the FAQ's
		// question with the trailing sentence as its answer.
		expect(parseIntent('Can you add this to our FAQ? It really matters')).toEqual({
			kind: 'faq_create',
			question: null,
			answer: null,
		});
	});

	it('does not invent a question from punctuation alone', () => {
		expect(parseIntent('add a faq : ?')).toEqual({
			kind: 'faq_create',
			question: null,
			answer: null,
		});
	});

	it('strips a leading "question:" label so it never leaks into the question', () => {
		// "question:" is command syntax, not part of the question text.
		expect(parseIntent('add an FAQ question: Do you deliver? yes')).toEqual({
			kind: 'faq_create',
			question: 'Do you deliver?',
			answer: 'yes',
		});
	});

	it('does not treat "to the knowledge base" command boilerplate as the answer', () => {
		expect(parseIntent('add a faq "Returns" to the knowledge base')).toEqual({
			kind: 'faq_create',
			question: 'Returns',
			answer: null,
		});
	});

	it('ignores a quoted phrase that sits before the add-FAQ command', () => {
		// The quoted "Returns" is page context; the real command follows it.
		expect(parseIntent('On the "Returns" page, add an FAQ: Do you accept returns? Yes')).toEqual({
			kind: 'faq_create',
			question: 'Do you accept returns?',
			answer: 'Yes',
		});
	});

	it('still extracts a quoted title when no add-FAQ command marker is found', () => {
		// "knowledge" (no "base") matches the KB context but not the command marker,
		// so the payload falls back to the whole message and the quote still wins.
		expect(parseIntent('add to my knowledge "Hours" we open at 9')).toEqual({
			kind: 'faq_create',
			question: 'Hours',
			answer: 'we open at 9',
		});
	});
});

describe('parseIntent — conversation context', () => {
	it('reads a subjectless browse/search as an FAQ ask when the topic is faq', () => {
		// A bare "list them" / "anything about refunds?" names no subject, but with the
		// conversation on the knowledge base these resolve against it.
		expect(parseIntent('can you list them?', { topic: 'faq' })).toEqual({ kind: 'faq_list' });
		expect(parseIntent('anything about refunds?', { topic: 'faq' })).toEqual({
			kind: 'faq_search',
			query: 'refunds',
		});
	});

	it('does not infer FAQ creation from context (a create verb is usually a question)', () => {
		// "what should I add?" / "how do I create an invoice?" merely contain a create
		// verb; the rule-based router does NOT turn that into faq_create from context —
		// it leaves them for the knowledge-answer path. Creating needs explicit phrasing.
		expect(parseIntent('What should I add?', { topic: 'faq' })).toEqual({ kind: 'unknown' });
		expect(parseIntent('how do I create an invoice?', { topic: 'faq' })).toEqual({
			kind: 'unknown',
		});
	});

	it('does not attach a bare pleasantry to an active FAQ topic', () => {
		// No FAQ action, so context must not turn "thanks" into a list dump.
		expect(parseIntent('thanks!', { topic: 'faq' })).toEqual({ kind: 'unknown' });
	});

	it('lets a self-named ask win over the context', () => {
		// The message names a company field, so faq context does not hijack it.
		expect(parseIntent("what's our website?", { topic: 'faq' })).toEqual({
			kind: 'company_info',
			fields: ['website'],
		});
	});

	it('does not let faq context hijack a company ask that carries a verb or preposition', () => {
		// "about"/"show" would satisfy hasFaqAction, but a named company subject wins.
		expect(parseIntent('tell me about our website', { topic: 'faq' })).toEqual({
			kind: 'company_info',
			fields: ['website'],
		});
		expect(parseIntent('show my company info', { topic: 'faq' })).toEqual({
			kind: 'company_info',
			fields: [],
		});
	});

	it('ignores context it does not act on (company is tracked, not routed)', () => {
		expect(parseIntent('what should I add?', { topic: 'company' })).toEqual({ kind: 'unknown' });
	});
});

describe('resolveIntent — multi-turn', () => {
	it('resolves a bare browse follow-up using the prior FAQ turn', () => {
		const conversation = [
			user("what's my website?"),
			assistant('Your website is https://example.com.'),
			user('how many faqs do we have?'),
			assistant('Your knowledge base has 3 FAQs: …'),
			user('show me them'),
		];
		expect(resolveIntent(conversation)).toEqual({ kind: 'faq_list' });
	});

	it('inherits FAQ context from an assistant knowledge answer, not just user turns', () => {
		// The user's prior turn ("what's our best price?") parses as unknown; the proof
		// the chat is on the knowledge base is the assistant's cited answer. A bare
		// search follow-up should still resolve against the FAQs.
		const conversation = [
			user("what's our best price?"),
			assistant('Our basic plan is $9/mo.\n\n(From your FAQ “How much does it cost?”.)'),
			user('anything about refunds?'),
		];
		expect(resolveIntent(conversation)).toEqual({ kind: 'faq_search', query: 'refunds' });
	});

	it('leaves a turn that stands on its own untouched', () => {
		const conversation = [
			user('how many faqs do we have?'),
			assistant('Your knowledge base has 3 FAQs: …'),
			user("what's our phone number?"),
		];
		expect(resolveIntent(conversation)).toEqual({ kind: 'company_info', fields: ['phone'] });
	});

	it('falls back to unknown when no earlier turn set a topic', () => {
		const conversation = [user('hello'), assistant('Hi!'), user('what should I add?')];
		expect(resolveIntent(conversation)).toEqual({ kind: 'unknown' });
	});

	it('uses the most recent topic when the conversation moved on', () => {
		// The chat drifted from FAQs to the company record; a bare "add" follow-up
		// should not be pulled back to the older FAQ topic.
		const conversation = [
			user('list our faqs'),
			assistant('…'),
			user('what about our address?'),
			assistant('1 Main St.'),
			user('what should I add?'),
		];
		// Most recent topic is company, which we do not route, so it stays unknown.
		expect(resolveIntent(conversation)).toEqual({ kind: 'unknown' });
	});

	it('does not reach back past the lookback window for a topic', () => {
		// The only FAQ turn is far in the past; a string of subjectless turns sits
		// between it and the follow-up, so the capped scan never reaches it.
		const filler = Array.from({ length: 7 }, () => [user('hmm'), assistant('…')]).flat();
		const conversation = [
			user('how many faqs do we have?'),
			assistant('Your knowledge base has 3 FAQs: …'),
			...filler,
			user('what should I add?'),
		];
		expect(resolveIntent(conversation)).toEqual({ kind: 'unknown' });
	});
});

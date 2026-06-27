import { describe, expect, it } from 'vitest';
import { parseIntent } from './intent';

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

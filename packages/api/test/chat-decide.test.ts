import type { ChatMessage } from '@rivus/core';
import type { LanguageModel } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import {
	type AgentDecision,
	createDecider,
	createDeciderFromConfig,
	decisionToIntent,
	type GenerateDecisionFn,
} from '../src/services/chat/decide';

const user = (content: string): ChatMessage => ({ role: 'user', content });
const assistant = (content: string): ChatMessage => ({ role: 'assistant', content });

/** A complete decision with defaults; override the fields a case cares about. */
function decision(over: Partial<AgentDecision>): AgentDecision {
	return {
		action: 'unknown',
		fields: [],
		query: '',
		answerQuestion: '',
		question: null,
		answer: null,
		topic: '',
		...over,
	};
}

/** A fake model: returns the scripted decision and records what it was asked. */
function fakeGenerate(result: AgentDecision): { generate: GenerateDecisionFn; calls: string[] } {
	const calls: string[] = [];
	const generate: GenerateDecisionFn = async (options) => {
		calls.push(options.prompt);
		return { object: result };
	};
	return { generate, calls };
}

// A stand-in model handle — never used by the fake generate, just satisfies the type.
const MODEL = {} as unknown as LanguageModel;

describe('decisionToIntent', () => {
	it('maps each action onto the matching intent', () => {
		expect(decisionToIntent(decision({ action: 'greeting' }), '')).toEqual({ kind: 'greeting' });
		expect(decisionToIntent(decision({ action: 'help' }), '')).toEqual({ kind: 'help' });
		expect(decisionToIntent(decision({ action: 'company_info', fields: ['website'] }), '')).toEqual(
			{ kind: 'company_info', fields: ['website'] },
		);
		expect(decisionToIntent(decision({ action: 'faq_list' }), '')).toEqual({ kind: 'faq_list' });
		expect(decisionToIntent(decision({ action: 'faq_search', query: 'refunds' }), '')).toEqual({
			kind: 'faq_search',
			query: 'refunds',
			existence: false,
		});
		expect(
			decisionToIntent(decision({ action: 'faq_update', topic: 'returns', answer: '30 days' }), ''),
		).toEqual({ kind: 'faq_update', topic: 'returns', answer: '30 days' });
		expect(
			decisionToIntent(
				decision({ action: 'faq_create', question: 'Do you ship?', answer: 'Yes' }),
				'',
			),
		).toEqual({ kind: 'faq_create', question: 'Do you ship?', answer: 'Yes' });
		expect(decisionToIntent(decision({ action: 'unknown' }), '')).toEqual({ kind: 'unknown' });
	});

	it('treats an empty search as a list', () => {
		expect(decisionToIntent(decision({ action: 'faq_search', query: '   ' }), '')).toEqual({
			kind: 'faq_list',
		});
	});

	it('flags an existence-check faq_search from the raw user turn', () => {
		// The model routes "do we have an FAQ about X?" to faq_search; reading the raw turn
		// marks it as an existence check so the assistant keeps it on the list path.
		expect(
			decisionToIntent(
				decision({ action: 'faq_search', query: 'parking' }),
				'do we have an FAQ about parking?',
			),
		).toEqual({ kind: 'faq_search', query: 'parking', existence: true });
	});

	it('drops an answer with no question so a create never breaks schema validation', () => {
		// The model may emit an answer without a question; that violates the parser's
		// invariant, so we reset to "nothing yet" and the assistant asks for the whole FAQ.
		expect(
			decisionToIntent(decision({ action: 'faq_create', answer: 'Yes, within 30 days' }), ''),
		).toEqual({ kind: 'faq_create', question: null, answer: null });
		// A blank/whitespace question is treated the same as none.
		expect(
			decisionToIntent(decision({ action: 'faq_create', question: '   ', answer: 'Yes' }), ''),
		).toEqual({ kind: 'faq_create', question: null, answer: null });
	});

	it('falls back to the raw user text when faq_answer omits the question', () => {
		expect(decisionToIntent(decision({ action: 'faq_answer' }), 'how do I cancel?')).toEqual({
			kind: 'faq_answer',
			question: 'how do I cancel?',
		});
		// …but prefers the model's restated question when present.
		expect(
			decisionToIntent(decision({ action: 'faq_answer', answerQuestion: 'cancellation' }), 'raw'),
		).toEqual({ kind: 'faq_answer', question: 'cancellation' });
	});
});

describe('createDecider — without a model', () => {
	it('routes deterministically via resolveIntent', async () => {
		const decide = createDecider();
		expect(await decide([user('what is our website?')])).toEqual({
			kind: 'company_info',
			fields: ['website'],
		});
	});
});

describe('createDecider — with a model', () => {
	it('routes using the model and sends the whole transcript', async () => {
		const { generate, calls } = fakeGenerate(decision({ action: 'faq_create' }));
		const decide = createDecider({ model: MODEL, generate });
		const intent = await decide([
			user('how many faqs do we have?'),
			assistant('Your knowledge base has 3 FAQs: …'),
			user('What should I add?'),
		]);
		expect(intent).toEqual({ kind: 'faq_create', question: null, answer: null });
		// The transcript (both sides) is handed to the model, not just the last turn.
		expect(calls[0]).toContain('User: how many faqs do we have?');
		expect(calls[0]).toContain('Assistant: Your knowledge base has 3 FAQs: …');
		expect(calls[0]).toContain('User: What should I add?');
	});

	it('bounds the transcript: recent turns only, each clipped', async () => {
		const { generate, calls } = fakeGenerate(decision({ action: 'faq_list' }));
		const decide = createDecider({ model: MODEL, generate });
		const many = Array.from({ length: 20 }, (_, i) => user(`message ${i}`));
		many.push(user(`${'x'.repeat(2000)} END`));
		await decide(many);
		const prompt = calls[0] ?? '';
		// Only the most recent turns are sent — the oldest are dropped…
		expect(prompt).not.toContain('message 0');
		expect(prompt).toContain('message 19');
		expect(prompt.split('\n').length).toBeLessThanOrEqual(12);
		// …and an over-long message is clipped (its tail never reaches the model).
		expect(prompt).not.toContain('END');
		expect(prompt).toContain('…');
	});

	it('falls back to deterministic routing when the model call fails', async () => {
		const generate: GenerateDecisionFn = async () => {
			throw new Error('model down');
		};
		const warn = vi.fn();
		const decide = createDecider({ model: MODEL, generate, logger: { warn } });
		// "what is our website?" still routes, via the rule-based fallback.
		expect(await decide([user('what is our website?')])).toEqual({
			kind: 'company_info',
			fields: ['website'],
		});
		expect(warn).toHaveBeenCalledOnce();
	});
});

describe('createDeciderFromConfig', () => {
	it('routes deterministically when no ANTHROPIC_API_KEY is set', async () => {
		const decide = createDeciderFromConfig({ ANTHROPIC_MODEL: 'claude-haiku-4-5' });
		expect(await decide([user('faqs')])).toEqual({ kind: 'faq_list' });
	});

	it('builds a model-backed decider when a key is configured', () => {
		// Construction only — we don't invoke it (that would hit the network). Proving the
		// keyed branch wires a model provider without throwing is enough here.
		const decide = createDeciderFromConfig({
			ANTHROPIC_API_KEY: 'sk-test',
			ANTHROPIC_MODEL: 'claude-haiku-4-5',
		});
		expect(typeof decide).toBe('function');
	});
});

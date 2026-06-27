import type { AccountId, Faq, FaqId } from '@rivus/core';
import type { LanguageModel } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import {
	AiFaqAnswerService,
	createFaqAnswerService,
	deterministicFaqAnswer,
	type FaqAnswerService,
	type GenerateObjectFn,
	NoopFaqAnswerService,
} from '../src/services/faq-answer';

function makeFaq(overrides: Partial<Faq> = {}): Faq {
	const now = new Date('2026-01-01T00:00:00.000Z').toISOString();
	return {
		id: 'faq-1' as FaqId,
		accountId: 'acct-1' as AccountId,
		question: 'How much does your service cost?',
		answer: 'Our standard rate is $125 an hour and $85 on weekends.',
		category: 'Pricing',
		status: 'published',
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

/**
 * A fake for the injected object-generator. The generic {@link GenerateObjectFn}
 * can't be satisfied by a concrete mock (its `object` would have to be every `T`
 * at once), so we cast at the boundary and keep the raw mock for assertions.
 */
function fakeGenerate(impl: (options: { model: LanguageModel; prompt: string }) => unknown) {
	const mock = vi.fn(impl as (...args: unknown[]) => unknown);
	return { generate: mock as unknown as GenerateObjectFn, mock };
}

// Two interchangeable placeholder models; the fake `generate` branches on them to
// exercise provider-fallback ordering without touching a real model.
const PRIMARY = 'primary' as unknown as LanguageModel;
const BACKUP = 'backup' as unknown as LanguageModel;

describe('AiFaqAnswerService.answer', () => {
	it('answers a differently-worded question and cites the source FAQ', async () => {
		const candidates = [
			makeFaq({
				id: 'faq-product' as FaqId,
				question: 'What is your best product?',
				answer: 'It is great.',
				category: 'Product',
			}),
			makeFaq({ id: 'faq-price' as FaqId }),
		];
		const { generate, mock } = fakeGenerate(() => ({
			object: {
				answered: true,
				answer: 'Our standard rate is $125 an hour, and $85 on weekends.',
				faqIds: ['faq-price'],
			},
		}));
		const service = new AiFaqAnswerService({ models: [PRIMARY], generate });

		const result = await service.answer({ question: "what's our best price?" }, candidates);

		expect(result.answered).toBe(true);
		expect(result.answer).toContain('$125');
		expect(result.sources).toEqual(['faq-price']);
		const options = mock.mock.calls[0]?.[0] as { schemaName?: string; prompt: string };
		expect(options.schemaName).toBe('faq_answer');
		// The question and — unlike the similarity check — the FAQ *answers* are sent,
		// since the model needs them to compose a grounded reply.
		expect(options.prompt).toContain("what's our best price?");
		expect(options.prompt).toContain('$125 an hour and $85 on weekends');
	});

	it('reports not-answered when the knowledge base does not cover the question', async () => {
		const { generate } = fakeGenerate(() => ({
			object: { answered: false, answer: '', faqIds: [] },
		}));
		const service = new AiFaqAnswerService({ models: [PRIMARY], generate });

		const result = await service.answer({ question: 'what is the meaning of life?' }, [makeFaq()]);

		expect(result).toEqual({ answered: false, answer: '', sources: [] });
	});

	it('short-circuits with no model call when there are no FAQs', async () => {
		const { generate, mock } = fakeGenerate(() => ({ object: null }));
		const service = new AiFaqAnswerService({ models: [PRIMARY], generate });

		expect(await service.answer({ question: 'anything?' }, [])).toEqual({
			answered: false,
			answer: '',
			sources: [],
		});
		expect(mock).not.toHaveBeenCalled();
	});

	it('drops hallucinated source ids and falls back to the closest FAQ', async () => {
		const { generate } = fakeGenerate(() => ({
			object: { answered: true, answer: 'Our rate is $125/hr.', faqIds: ['ghost-id'] },
		}));
		const service = new AiFaqAnswerService({ models: [PRIMARY], generate });

		const result = await service.answer({ question: 'how much for a service call?' }, [makeFaq()]);

		expect(result.answered).toBe(true);
		expect(result.answer).toBe('Our rate is $125/hr.');
		// The made-up id is rejected; the keyword-closest FAQ becomes the cited source.
		expect(result.sources).toEqual(['faq-1']);
	});

	it('falls back to a deterministic answer when the model returns blank text', async () => {
		const { generate } = fakeGenerate(() => ({
			object: { answered: true, answer: '   ', faqIds: ['faq-1'] },
		}));
		const service = new AiFaqAnswerService({ models: [PRIMARY], generate });

		const result = await service.answer({ question: 'what does a service call cost?' }, [
			makeFaq(),
		]);

		expect(result.answered).toBe(true);
		expect(result.answer).toBe('Our standard rate is $125 an hour and $85 on weekends.');
		expect(result.sources).toEqual(['faq-1']);
	});

	it('falls back to a deterministic answer when every model fails', async () => {
		const { generate } = fakeGenerate(() => {
			throw new Error('provider down');
		});
		const service = new AiFaqAnswerService({ models: [PRIMARY], generate });

		const result = await service.answer({ question: 'what is the service cost?' }, [makeFaq()]);

		expect(result.answered).toBe(true);
		expect(result.answer).toContain('$125');
		expect(result.sources).toEqual(['faq-1']);
	});

	it('returns not-answered when a model outage leaves nothing keyword-relevant', async () => {
		const { generate } = fakeGenerate(() => {
			throw new Error('provider down');
		});
		const service = new AiFaqAnswerService({ models: [PRIMARY], generate });

		// Nothing in the question overlaps the FAQ, so the deterministic fallback can't
		// guess — it reports not-answered rather than returning an unrelated FAQ.
		const result = await service.answer({ question: 'do you ship internationally?' }, [makeFaq()]);

		expect(result.answered).toBe(false);
	});

	it('falls back to the next model when the primary errors', async () => {
		const { generate, mock } = fakeGenerate(({ model }) => {
			if (model === PRIMARY) {
				throw new Error('primary down');
			}
			return { object: { answered: true, answer: 'Backup answered.', faqIds: ['faq-1'] } };
		});
		const service = new AiFaqAnswerService({ models: [PRIMARY, BACKUP], generate });

		const result = await service.answer({ question: 'cost?' }, [makeFaq()]);

		expect(result.answer).toBe('Backup answered.');
		expect(mock).toHaveBeenCalledTimes(2);
	});

	it('caps a runaway model answer to keep replies chat-sized', async () => {
		const { generate } = fakeGenerate(() => ({
			object: { answered: true, answer: 'z'.repeat(5000), faqIds: ['faq-1'] },
		}));
		const service = new AiFaqAnswerService({ models: [PRIMARY], generate });

		const result = await service.answer({ question: 'cost?' }, [makeFaq()]);

		expect(result.answer.length).toBeLessThanOrEqual(1200);
	});

	it('sends the full FAQ answer to the model, not just a short prefix', async () => {
		// A fact buried past the first several hundred characters must still reach the
		// model — FAQ answers can be up to 4000 chars and the question may target the end.
		const longAnswer = `${'Filler sentence. '.repeat(60)}The weekend rate is $85.`;
		expect(longAnswer.length).toBeGreaterThan(900);
		const { generate, mock } = fakeGenerate(() => ({
			object: { answered: true, answer: 'The weekend rate is $85.', faqIds: ['faq-1'] },
		}));
		const service = new AiFaqAnswerService({ models: [PRIMARY], generate });

		await service.answer({ question: 'what is the weekend rate?' }, [
			makeFaq({ answer: longAnswer }),
		]);

		const options = mock.mock.calls[0]?.[0] as { prompt: string };
		expect(options.prompt).toContain('The weekend rate is $85.');
	});

	it('keeps the answer but drops sources when the only cited id is unusable and nothing overlaps', async () => {
		// The model answered and cited only a hallucinated id; the question shares no
		// keyword with the FAQ, so there's no closest fallback — we return the answer
		// with empty sources rather than inventing a citation.
		const { generate } = fakeGenerate(() => ({
			object: { answered: true, answer: 'A general reply.', faqIds: ['ghost-id'] },
		}));
		const service = new AiFaqAnswerService({ models: [PRIMARY], generate });

		const result = await service.answer({ question: 'completely unrelated zzqqx?' }, [makeFaq()]);

		expect(result).toEqual({ answered: true, answer: 'A general reply.', sources: [] });
	});

	it('logs and degrades to deterministic when a model fails', async () => {
		const warnings: string[] = [];
		const { generate } = fakeGenerate(() => {
			throw new Error('boom');
		});
		const service = new AiFaqAnswerService({
			models: [PRIMARY],
			generate,
			logger: { warn: (message) => warnings.push(message) },
		});

		const result = await service.answer({ question: 'what is the cost?' }, [makeFaq()]);

		expect(result.answered).toBe(true);
		expect(warnings[0]).toMatch(/faq_answer/);
	});
});

describe('createFaqAnswerService', () => {
	const baseConfig = {
		OPENAI_MODEL: 'gpt-5.4-mini',
		GEMINI_MODEL: 'gemini-2.5-flash',
		XAI_MODEL: 'grok-4-fast',
		ANTHROPIC_MODEL: 'claude-haiku-4-5',
	};

	it('returns a deterministic no-op service when no provider key is set', () => {
		const service = createFaqAnswerService({ ...baseConfig });
		expect(service).toBeInstanceOf(NoopFaqAnswerService);
	});

	it('returns an AI-backed service when at least one provider key is set', () => {
		const service = createFaqAnswerService({ ...baseConfig, OPENAI_API_KEY: 'sk-test' });
		expect(service).toBeInstanceOf(AiFaqAnswerService);
	});
});

describe('deterministicFaqAnswer / NoopFaqAnswerService', () => {
	it('answers with the most keyword-relevant FAQ', async () => {
		const faqs = [
			makeFaq({
				id: 'faq-hours' as FaqId,
				question: 'What are your hours?',
				answer: '9 to 5.',
				category: 'General',
			}),
			makeFaq({
				id: 'faq-cost' as FaqId,
				question: 'What does a service call cost?',
				answer: 'It costs $89.',
				category: 'Pricing',
			}),
		];
		const result = deterministicFaqAnswer('how much does a service call cost?', faqs);

		expect(result).toEqual({ answered: true, answer: 'It costs $89.', sources: ['faq-cost'] });
	});

	it('reports not-answered when nothing overlaps', async () => {
		const service: FaqAnswerService = new NoopFaqAnswerService();
		const result = await service.answer({ question: 'tell me a joke' }, [makeFaq()]);

		expect(result).toEqual({ answered: false, answer: '', sources: [] });
	});

	it('reports not-answered for an empty knowledge base', () => {
		expect(deterministicFaqAnswer('anything?', [])).toEqual({
			answered: false,
			answer: '',
			sources: [],
		});
	});
});

import type { AccountId, Faq, FaqId } from '@rivus/core';
import type { LanguageModel } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import {
	AiFaqSimilarityService,
	type FaqSimilarityService,
	type GenerateObjectFn,
	NoopFaqSimilarityService,
} from '../src/services/faq-similarity';

function makeFaq(overrides: Partial<Faq> = {}): Faq {
	const now = new Date('2026-01-01T00:00:00.000Z').toISOString();
	return {
		id: 'faq-1' as FaqId,
		accountId: 'acct-1' as AccountId,
		question: 'How much is a service call?',
		answer: 'Our standard diagnostic visit is $89.',
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

// Two interchangeable placeholder models; the fake `generate` branches on them
// to exercise provider-fallback ordering without touching a real model.
const PRIMARY = 'primary' as unknown as LanguageModel;
const BACKUP = 'backup' as unknown as LanguageModel;

const NEW_INPUT = { question: 'What does a service call cost?', answer: 'It is $89 to come out.' };

describe('AiFaqSimilarityService.findSimilar', () => {
	it('returns the matched candidate and sends questions but not answers', async () => {
		const candidates = [
			makeFaq({ id: 'faq-1' as FaqId, question: 'Do you offer weekend hours?' }),
			makeFaq({
				id: 'faq-2' as FaqId,
				question: 'How much is a service call?',
				answer: 'SECRET-ANSWER-TEXT',
			}),
		];
		const { generate, mock } = fakeGenerate(() => ({
			object: { faqId: 'faq-2', confidence: 0.92, reason: 'Same pricing question.' },
		}));
		const service = new AiFaqSimilarityService({ models: [PRIMARY], generate });

		const result = await service.findSimilar(NEW_INPUT, candidates);

		expect(result).toEqual({ faqId: 'faq-2', confidence: 0.92, reason: 'Same pricing question.' });
		const options = mock.mock.calls[0]?.[0] as { schemaName?: string; prompt: string };
		expect(options.schemaName).toBe('faq_similarity');
		expect(options.prompt).toContain('How much is a service call?');
		expect(options.prompt).toContain(NEW_INPUT.question);
		// Candidate answers must never be sent — only id/question/category.
		expect(options.prompt).not.toContain('SECRET-ANSWER-TEXT');
	});

	it('returns null when the model reports no match', async () => {
		const { generate } = fakeGenerate(() => ({
			object: { faqId: null, confidence: 0, reason: 'No duplicate.' },
		}));
		const service = new AiFaqSimilarityService({ models: [PRIMARY], generate });

		expect(await service.findSimilar(NEW_INPUT, [makeFaq()])).toBeNull();
	});

	it('rejects a hallucinated id that was never in the candidate set', async () => {
		const { generate } = fakeGenerate(() => ({
			object: { faqId: 'faq-999', confidence: 0.99, reason: 'made up' },
		}));
		const service = new AiFaqSimilarityService({ models: [PRIMARY], generate });

		expect(await service.findSimilar(NEW_INPUT, [makeFaq({ id: 'faq-1' as FaqId })])).toBeNull();
	});

	it('rejects a match below the confidence floor', async () => {
		const { generate } = fakeGenerate(() => ({
			object: { faqId: 'faq-1', confidence: 0.3, reason: 'weak' },
		}));
		const service = new AiFaqSimilarityService({ models: [PRIMARY], generate });

		expect(await service.findSimilar(NEW_INPUT, [makeFaq({ id: 'faq-1' as FaqId })])).toBeNull();
	});

	it('short-circuits with no model call when there are no candidates', async () => {
		const { generate, mock } = fakeGenerate(() => ({ object: null }));
		const service = new AiFaqSimilarityService({ models: [PRIMARY], generate });

		expect(await service.findSimilar(NEW_INPUT, [])).toBeNull();
		expect(mock).not.toHaveBeenCalled();
	});

	it('returns null (never throws) when the only model fails', async () => {
		const { generate } = fakeGenerate(() => {
			throw new Error('provider down');
		});
		const service = new AiFaqSimilarityService({ models: [PRIMARY], generate });

		await expect(service.findSimilar(NEW_INPUT, [makeFaq()])).resolves.toBeNull();
	});

	it('falls back to the next model when the primary errors', async () => {
		const { generate, mock } = fakeGenerate(({ model }) => {
			if (model === PRIMARY) {
				throw new Error('primary down');
			}
			return { object: { faqId: 'faq-1', confidence: 0.8, reason: 'backup matched' } };
		});
		const service = new AiFaqSimilarityService({ models: [PRIMARY, BACKUP], generate });

		const result = await service.findSimilar(NEW_INPUT, [makeFaq({ id: 'faq-1' as FaqId })]);

		expect(result?.faqId).toBe('faq-1');
		expect(mock).toHaveBeenCalledTimes(2);
	});
});

describe('AiFaqSimilarityService.mergeSuggestion', () => {
	it('returns the model-combined question and answer (trimmed)', async () => {
		const { generate } = fakeGenerate(() => ({
			object: { question: '  Combined question?  ', answer: '  Combined answer.  ' },
		}));
		const service = new AiFaqSimilarityService({ models: [PRIMARY], generate });

		const result = await service.mergeSuggestion(NEW_INPUT, makeFaq());

		expect(result).toEqual({ question: 'Combined question?', answer: 'Combined answer.' });
	});

	it('falls back to a deterministic combine when the model fails', async () => {
		const { generate } = fakeGenerate(() => {
			throw new Error('down');
		});
		const service = new AiFaqSimilarityService({ models: [PRIMARY], generate });
		const existing = makeFaq({ answer: 'Existing answer.' });

		const result = await service.mergeSuggestion(
			{ question: 'q', answer: 'Brand new detail.' },
			existing,
		);

		expect(result.question).toBe(existing.question);
		expect(result.answer).toContain('Existing answer.');
		expect(result.answer).toContain('Brand new detail.');
	});

	it('falls back when the model returns blank text', async () => {
		const { generate } = fakeGenerate(() => ({ object: { question: '', answer: '' } }));
		const service = new AiFaqSimilarityService({ models: [PRIMARY], generate });
		const existing = makeFaq({ answer: 'Kept answer.' });

		const result = await service.mergeSuggestion({ question: 'q', answer: '' }, existing);

		expect(result).toEqual({ question: existing.question, answer: 'Kept answer.' });
	});

	it('clamps a model-merged answer to the FAQ length limit', async () => {
		const { generate } = fakeGenerate(() => ({
			object: { question: 'Combined?', answer: 'z'.repeat(5000) },
		}));
		const service = new AiFaqSimilarityService({ models: [PRIMARY], generate });

		const result = await service.mergeSuggestion(NEW_INPUT, makeFaq());

		expect(result.answer.length).toBe(4000);
		expect(result.question).toBe('Combined?');
	});

	it('clamps an oversized deterministic-fallback answer', async () => {
		const { generate } = fakeGenerate(() => {
			throw new Error('down');
		});
		const service = new AiFaqSimilarityService({ models: [PRIMARY], generate });
		const existing = makeFaq({ answer: 'x'.repeat(3800) });

		const result = await service.mergeSuggestion(
			{ question: 'q', answer: 'y'.repeat(500) },
			existing,
		);

		expect(result.answer.length).toBe(4000);
	});
});

describe('NoopFaqSimilarityService', () => {
	it('never finds a match and passes input through on merge', async () => {
		const service: FaqSimilarityService = new NoopFaqSimilarityService();

		expect(await service.findSimilar(NEW_INPUT, [makeFaq()])).toBeNull();
		expect(await service.mergeSuggestion(NEW_INPUT, makeFaq())).toEqual(NEW_INPUT);
	});
});

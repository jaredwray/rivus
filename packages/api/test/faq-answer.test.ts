import type { AccountId, Faq, FaqId } from '@rivus/core';
import type { EmbeddingModel, LanguageModel } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import {
	AiFaqAnswerService,
	createFaqAnswerService,
	createFaqRetriever,
	deterministicFaqAnswer,
	EmbeddingFaqRetriever,
	type EmbedManyFn,
	type FaqAnswerService,
	type FaqRetriever,
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

		expect(result).toEqual({ answered: false, answer: '', sources: [], grounding: 'model' });
	});

	it('short-circuits with no model call when there are no FAQs', async () => {
		const { generate, mock } = fakeGenerate(() => ({ object: null }));
		const service = new AiFaqAnswerService({ models: [PRIMARY], generate });

		expect(await service.answer({ question: 'anything?' }, [])).toEqual({
			answered: false,
			answer: '',
			sources: [],
			// No model ran at all, so nothing here is model-grounded.
			grounding: 'keyword',
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

		expect(result).toEqual({
			answered: true,
			answer: 'A general reply.',
			sources: [],
			grounding: 'model',
		});
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
		OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
		GEMINI_MODEL: 'gemini-2.5-flash',
		GOOGLE_EMBEDDING_MODEL: 'text-embedding-004',
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

		expect(result).toEqual({
			answered: true,
			answer: 'It costs $89.',
			sources: ['faq-cost'],
			grounding: 'keyword',
		});
	});

	it('reports not-answered when nothing overlaps', async () => {
		const service: FaqAnswerService = new NoopFaqAnswerService();
		const result = await service.answer({ question: 'tell me a joke' }, [makeFaq()]);

		expect(result).toEqual({ answered: false, answer: '', sources: [], grounding: 'keyword' });
	});

	it('reports not-answered for an empty knowledge base', () => {
		expect(deterministicFaqAnswer('anything?', [])).toEqual({
			answered: false,
			answer: '',
			sources: [],
			grounding: 'keyword',
		});
	});
});

// EmbeddingModel is a union that includes `string`, so a label stands in for a model;
// the injected `embed` never resolves it.
const EMBED_MODEL: EmbeddingModel = 'test-embedding-model';

/** A deterministic stand-in for an embedding model: orthogonal vectors per topic. */
function vectorFor(text: string): number[] {
	const t = text.toLowerCase();
	if (t.includes('pric') || t.includes('cost') || t.includes('rate')) return [1, 0, 0, 0];
	if (t.includes('hour') || t.includes('open')) return [0, 1, 0, 0];
	if (t.includes('refund') || t.includes('return')) return [0, 0, 1, 0];
	return [0, 0, 0, 1];
}

/** A fake {@link EmbedManyFn} that records each batch's values and embeds them by topic. */
function fakeEmbed(): { embed: EmbedManyFn; calls: string[][] } {
	const calls: string[][] = [];
	const embed: EmbedManyFn = async ({ values }) => {
		calls.push(values);
		return { embeddings: values.map(vectorFor) };
	};
	return { embed, calls };
}

describe('AiFaqAnswerService.answer — with a retriever', () => {
	it('lets the retriever pick which FAQs reach the model for a large knowledge base', async () => {
		// 30 newest-but-irrelevant FAQs plus the one that actually answers, oldest (last).
		// Newest-first slicing would drop it past the cap; the retriever keeps it.
		const filler = Array.from({ length: 30 }, (_, i) =>
			makeFaq({ id: `faq-${i}` as FaqId, question: `Filler ${i}`, answer: 'n/a' }),
		);
		const target = makeFaq({
			id: 'faq-target' as FaqId,
			question: 'How much does your service cost?',
			answer: 'Our rate is $125 an hour.',
		});
		const retrieve = vi.fn(async () => [target]);
		const { generate, mock } = fakeGenerate(() => ({
			object: { answered: true, answer: 'It is $125 an hour.', faqIds: ['faq-target'] },
		}));
		const service = new AiFaqAnswerService({
			models: [PRIMARY],
			generate,
			retriever: { retrieve },
		});

		const result = await service.answer({ question: "what's our best price?" }, [
			...filler,
			target,
		]);

		// The retriever was asked for the cap's worth of the full candidate set…
		expect(retrieve).toHaveBeenCalledWith("what's our best price?", expect.any(Array), 24);
		// …and only its picks were sent to the model (a non-retrieved FAQ never appears).
		const options = mock.mock.calls[0]?.[0] as { prompt: string };
		expect(options.prompt).toContain('faq-target');
		expect(options.prompt).not.toContain('Filler 0');
		expect(result.sources).toEqual(['faq-target']);
	});

	it('skips the retriever when the knowledge base fits the prompt cap', async () => {
		const retrieve = vi.fn(async () => [] as Faq[]);
		const { generate } = fakeGenerate(() => ({
			object: { answered: false, answer: '', faqIds: [] },
		}));
		const service = new AiFaqAnswerService({
			models: [PRIMARY],
			generate,
			retriever: { retrieve },
		});

		await service.answer({ question: 'cost?' }, [makeFaq(), makeFaq({ id: 'faq-2' as FaqId })]);

		// Two FAQs are under the cap, so there's nothing to rank — the retriever is untouched.
		expect(retrieve).not.toHaveBeenCalled();
	});
});

describe('EmbeddingFaqRetriever.retrieve', () => {
	// Distinct categories: makeFaq defaults category to 'Pricing', which would otherwise
	// make every FAQ's embedding text read as a pricing topic to the fake embedder.
	const hours = makeFaq({
		id: 'a' as FaqId,
		question: 'What are your hours?',
		answer: 'Open 9-5.',
		category: 'General',
	});
	const where = makeFaq({
		id: 'b' as FaqId,
		question: 'Where are you?',
		answer: 'Seattle.',
		category: 'General',
	});
	const cost = makeFaq({
		id: 'c' as FaqId,
		question: 'How much does it cost?',
		answer: 'Our rate is $125.',
		category: 'Pricing',
	});

	it('ranks by semantic similarity, surfacing a relevant older FAQ over newer ones', async () => {
		const { embed } = fakeEmbed();
		const retriever = new EmbeddingFaqRetriever({ model: EMBED_MODEL, embed });

		// Newest-first: hours, where, then the (oldest) pricing FAQ that answers the ask.
		const result = await retriever.retrieve("what's our best price?", [hours, where, cost], 2);

		expect(result).toHaveLength(2);
		expect(result[0]?.id).toBe('c');
	});

	it('passes the candidates through, unembedded, when they fit the limit', async () => {
		const { embed, calls } = fakeEmbed();
		const retriever = new EmbeddingFaqRetriever({ model: EMBED_MODEL, embed });

		const result = await retriever.retrieve('best price', [hours, where], 2);

		expect(result).toEqual([hours, where]);
		expect(calls).toHaveLength(0);
	});

	it('caches FAQ vectors so a repeat search re-embeds only the query', async () => {
		const { embed, calls } = fakeEmbed();
		const retriever = new EmbeddingFaqRetriever({ model: EMBED_MODEL, embed });

		await retriever.retrieve('best price', [hours, where, cost], 2);
		const second = await retriever.retrieve('opening hours', [hours, where, cost], 2);

		expect(calls[0]).toHaveLength(4); // query + three FAQs
		expect(calls[1]).toHaveLength(1); // FAQs cached; only the new query is embedded
		expect(second[0]?.id).toBe('a'); // and the cached vectors still rank correctly
	});

	it('re-embeds an FAQ after it is edited (its updatedAt changes)', async () => {
		const { embed, calls } = fakeEmbed();
		const retriever = new EmbeddingFaqRetriever({ model: EMBED_MODEL, embed });
		const editedCost = makeFaq({
			id: 'c' as FaqId,
			question: 'How much does it cost?',
			answer: 'Our rate is now $150.',
			updatedAt: '2026-02-01T00:00:00.000Z',
		});

		await retriever.retrieve('best price', [hours, where, cost], 2);
		await retriever.retrieve('best price', [hours, where, editedCost], 2);

		expect(calls[0]).toHaveLength(4); // query + three FAQs
		expect(calls[1]).toHaveLength(2); // hours/where cached; only the edited FAQ re-embeds
	});

	it('evicts the least-recently-used vector when the cache is full', async () => {
		const { embed, calls } = fakeEmbed();
		const retriever = new EmbeddingFaqRetriever({ model: EMBED_MODEL, embed, cacheCapacity: 1 });

		await retriever.retrieve('best price', [hours, cost], 1);
		await retriever.retrieve('best price', [hours, cost], 1);

		expect(calls[0]).toHaveLength(3); // query + both FAQs
		// Capacity 1 evicted `hours`, so the second search re-embeds it (plus the query).
		expect(calls[1]).toHaveLength(2);
	});

	it('degrades to the newest candidates when embedding fails', async () => {
		const warnings: string[] = [];
		const embed: EmbedManyFn = async () => {
			throw new Error('embed down');
		};
		const retriever = new EmbeddingFaqRetriever({
			model: EMBED_MODEL,
			embed,
			logger: { warn: (message) => warnings.push(message) },
		});

		const result = await retriever.retrieve('best price', [hours, where, cost], 2);

		expect(result.map((faq) => faq.id)).toEqual(['a', 'b']);
		expect(warnings[0]).toMatch(/embedding retrieval/i);
	});

	it('degrades to the newest candidates when the batch returns no query vector', async () => {
		const embed: EmbedManyFn = async () => ({ embeddings: [] });
		const retriever = new EmbeddingFaqRetriever({ model: EMBED_MODEL, embed });

		const result = await retriever.retrieve('best price', [hours, where, cost], 2);

		expect(result.map((faq) => faq.id)).toEqual(['a', 'b']);
	});

	it('keeps unscored candidates eligible when the batch is short a vector', async () => {
		// Only the query comes back embedded; the FAQ vectors are missing, so none can be
		// scored — retrieval still returns a full `limit` worth, in candidate order.
		const embed: EmbedManyFn = async ({ values }) => ({ embeddings: [vectorFor(values[0] ?? '')] });
		const retriever = new EmbeddingFaqRetriever({ model: EMBED_MODEL, embed });

		const result = await retriever.retrieve('best price', [hours, where, cost], 2);

		expect(result.map((faq) => faq.id)).toEqual(['a', 'b']);
	});
});

describe('createFaqRetriever', () => {
	const embedConfig = {
		OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
		GOOGLE_EMBEDDING_MODEL: 'text-embedding-004',
	};

	it('returns undefined when no embeddings provider key is set', () => {
		expect(createFaqRetriever({ ...embedConfig })).toBeUndefined();
	});

	it('builds a retriever from OpenAI when its key is set', () => {
		const retriever: FaqRetriever | undefined = createFaqRetriever({
			...embedConfig,
			OPENAI_API_KEY: 'sk-test',
		});
		expect(retriever).toBeInstanceOf(EmbeddingFaqRetriever);
	});

	it('falls back to Google embeddings when only its key is set', () => {
		const retriever = createFaqRetriever({
			...embedConfig,
			GOOGLE_GENERATIVE_AI_API_KEY: 'g-test',
		});
		expect(retriever).toBeInstanceOf(EmbeddingFaqRetriever);
	});
});

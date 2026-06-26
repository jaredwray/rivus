import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import type { Faq, FaqId } from '@rivus/core';
import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { Config } from '../config';

/**
 * When checking a new FAQ for duplicates we only ever send the existing FAQs'
 * questions (not their answers), and we cap how many we send, to keep the prompt
 * small and the token cost bounded. `MAX_OUTPUT_TOKENS` likewise caps the reply.
 */
const MAX_CANDIDATES = 50;
const MAX_OUTPUT_TOKENS = 600;
/** Below this the match is too weak to interrupt the user with a modal. */
const MIN_CONFIDENCE = 0.6;

/** What the model returns when asked to find a near-duplicate. */
const similaritySchema = z.object({
	faqId: z.string().nullable(),
	confidence: z.number(),
	reason: z.string(),
});

/** What the model returns when asked to combine two FAQs into one. */
const mergeSchema = z.object({
	question: z.string(),
	answer: z.string(),
});

export interface FaqSimilarityMatch {
	faqId: FaqId;
	/** 0..1 — how confident the model is that this is a duplicate. */
	confidence: number;
	/** One short sentence explaining the match, shown in the modal. */
	reason: string;
}

export interface FaqMergeSuggestion {
	question: string;
	answer: string;
}

export interface FaqSimilarityService {
	/**
	 * Return the existing FAQ that is the closest semantic duplicate of `input`,
	 * or `null` when none is similar enough (or the check can't run). Never throws.
	 */
	findSimilar(
		input: { question: string; answer: string },
		candidates: Faq[],
	): Promise<FaqSimilarityMatch | null>;
	/**
	 * Combine the new input with an existing FAQ into one improved FAQ. Never
	 * throws — falls back to a deterministic combine if the model is unavailable.
	 */
	mergeSuggestion(
		input: { question: string; answer: string },
		existing: Faq,
	): Promise<FaqMergeSuggestion>;
}

/**
 * The single AI call this service makes, narrowed to what we use. Injectable so
 * tests can drive the logic (fallback ordering, guards, parsing) without a model
 * or the network. Defaults to the AI SDK's {@link generateObject}.
 */
export type GenerateObjectFn = <T>(options: {
	model: LanguageModel;
	schema: z.ZodType<T>;
	schemaName?: string;
	system?: string;
	prompt: string;
	maxOutputTokens?: number;
}) => Promise<{ object: T }>;

const defaultGenerateObject: GenerateObjectFn = async (options) => {
	const { object } = await generateObject({
		model: options.model,
		schema: options.schema,
		schemaName: options.schemaName,
		system: options.system,
		prompt: options.prompt,
		maxOutputTokens: options.maxOutputTokens,
	});
	return { object };
};

const SIMILARITY_SYSTEM =
	'You deduplicate a customer-support FAQ knowledge base. Decide whether the NEW FAQ ' +
	'is a semantic near-duplicate of one of the EXISTING FAQs — the same underlying ' +
	'question, even if worded differently. Return the id of the single best matching ' +
	'existing FAQ with a confidence in [0,1], or faqId=null if none is a near-duplicate. ' +
	'Give a one-sentence reason.';

const MERGE_SYSTEM =
	'You merge two overlapping customer-support FAQs into one clear, non-redundant FAQ. ' +
	'Combine the information from both answers, keep it accurate and concise, remove ' +
	'duplication, and prefer the clearer phrasing. Return a single question and a single ' +
	'combined answer.';

/**
 * AI-backed duplicate detection. Tries each model in order, so callers can pass a
 * primary plus backups from other providers; if every model fails the call
 * degrades to `null` (find) or a deterministic combine (merge) rather than
 * throwing into the request path.
 */
export class AiFaqSimilarityService implements FaqSimilarityService {
	private readonly models: LanguageModel[];
	private readonly generate: GenerateObjectFn;

	constructor(options: { models: LanguageModel[]; generate?: GenerateObjectFn }) {
		this.models = options.models;
		this.generate = options.generate ?? defaultGenerateObject;
	}

	/** Try each model in turn; return the first success, or null if all fail. */
	private async generateWithFallback<T>(options: {
		schema: z.ZodType<T>;
		schemaName: string;
		system: string;
		prompt: string;
	}): Promise<T | null> {
		for (const model of this.models) {
			try {
				const { object } = await this.generate({
					model,
					schema: options.schema,
					schemaName: options.schemaName,
					system: options.system,
					prompt: options.prompt,
					maxOutputTokens: MAX_OUTPUT_TOKENS,
				});
				return object;
			} catch {
				// This provider failed — fall through to the next backup model.
			}
		}
		return null;
	}

	async findSimilar(
		input: { question: string; answer: string },
		candidates: Faq[],
	): Promise<FaqSimilarityMatch | null> {
		if (candidates.length === 0) {
			return null;
		}
		// Newest-first from the caller; keep the most recent and send only the
		// fields needed to judge similarity (no answers — keeps the prompt small).
		const shortlist = candidates.slice(0, MAX_CANDIDATES);
		const ids = new Set<string>(shortlist.map((faq) => faq.id));
		const existing = shortlist.map((faq) => ({
			id: faq.id,
			question: faq.question,
			category: faq.category,
		}));

		const result = await this.generateWithFallback({
			schema: similaritySchema,
			schemaName: 'faq_similarity',
			system: SIMILARITY_SYSTEM,
			prompt:
				`New FAQ:\nQuestion: ${input.question}\n` +
				`Answer: ${input.answer || '(none provided)'}\n\n` +
				`Existing FAQs (JSON array of {id, question, category}):\n${JSON.stringify(existing)}`,
		});

		if (!result || result.faqId === null) {
			return null;
		}
		// Guard against a hallucinated / stale id: only accept ids we actually sent.
		if (!ids.has(result.faqId)) {
			return null;
		}
		const confidence = Math.max(0, Math.min(1, result.confidence));
		if (confidence < MIN_CONFIDENCE) {
			return null;
		}
		return { faqId: result.faqId as FaqId, confidence, reason: result.reason };
	}

	async mergeSuggestion(
		input: { question: string; answer: string },
		existing: Faq,
	): Promise<FaqMergeSuggestion> {
		const result = await this.generateWithFallback({
			schema: mergeSchema,
			schemaName: 'faq_merge',
			system: MERGE_SYSTEM,
			prompt:
				`Existing FAQ:\nQuestion: ${existing.question}\nAnswer: ${existing.answer}\n\n` +
				`New FAQ the user just wrote:\nQuestion: ${input.question}\nAnswer: ${input.answer}`,
		});

		if (result?.question.trim() && result.answer.trim()) {
			return { question: result.question.trim(), answer: result.answer.trim() };
		}
		return fallbackMerge(input, existing);
	}
}

/**
 * Deterministic merge used when no model is available: keep the existing
 * question, and append the user's new answer when it adds something not already
 * present.
 */
function fallbackMerge(
	input: { question: string; answer: string },
	existing: Faq,
): FaqMergeSuggestion {
	const newAnswer = input.answer.trim();
	const answer =
		newAnswer && !existing.answer.includes(newAnswer)
			? `${existing.answer}\n\n${newAnswer}`.trim()
			: existing.answer;
	return { question: existing.question, answer };
}

/** A no-op service: reports no duplicates and merges by passing the input through. */
export class NoopFaqSimilarityService implements FaqSimilarityService {
	async findSimilar(): Promise<FaqSimilarityMatch | null> {
		return null;
	}

	async mergeSuggestion(input: { question: string; answer: string }): Promise<FaqMergeSuggestion> {
		return { question: input.question, answer: input.answer };
	}
}

/**
 * Build the duplicate-FAQ service from config. Each provider whose API key is set
 * is added to an ordered model list — OpenAI is the primary, with Google, xAI,
 * and Anthropic as backups (used in that order when an earlier provider errors).
 * When no key is set at all, returns a {@link NoopFaqSimilarityService} so the
 * feature degrades to "never a duplicate" and the API still boots.
 */
export function createFaqSimilarityService(
	config: Pick<
		Config,
		| 'OPENAI_API_KEY'
		| 'OPENAI_MODEL'
		| 'GOOGLE_GENERATIVE_AI_API_KEY'
		| 'GEMINI_MODEL'
		| 'XAI_API_KEY'
		| 'XAI_MODEL'
		| 'ANTHROPIC_API_KEY'
		| 'ANTHROPIC_MODEL'
	>,
): FaqSimilarityService {
	const models: LanguageModel[] = [];
	if (config.OPENAI_API_KEY) {
		models.push(createOpenAI({ apiKey: config.OPENAI_API_KEY })(config.OPENAI_MODEL));
	}
	if (config.GOOGLE_GENERATIVE_AI_API_KEY) {
		models.push(
			createGoogleGenerativeAI({ apiKey: config.GOOGLE_GENERATIVE_AI_API_KEY })(
				config.GEMINI_MODEL,
			),
		);
	}
	if (config.XAI_API_KEY) {
		models.push(createXai({ apiKey: config.XAI_API_KEY })(config.XAI_MODEL));
	}
	if (config.ANTHROPIC_API_KEY) {
		models.push(createAnthropic({ apiKey: config.ANTHROPIC_API_KEY })(config.ANTHROPIC_MODEL));
	}
	if (models.length === 0) {
		return new NoopFaqSimilarityService();
	}
	return new AiFaqSimilarityService({ models });
}

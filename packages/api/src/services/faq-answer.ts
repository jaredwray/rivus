import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import type { Faq, FaqId } from '@rivus/core';
import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { Config } from '../config';

/**
 * Answering a visitor's question from the knowledge base is retrieval-augmented:
 * we hand the model the account's FAQs and ask it to reply using only those. We
 * cap how many FAQs we send (newest first) and how long the reply can be so the
 * prompt and token cost stay bounded for a small business's knowledge base.
 */
const MAX_CANDIDATES = 24;
const MAX_OUTPUT_TOKENS = 700;
// Send each FAQ's full stored answer so a fact late in a long answer (the FAQ
// field allows up to 4000 chars) is still visible to the model — truncating to a
// short prefix could hide exactly the detail the question asks about. This equals
// the FAQ answer field cap, so a valid answer is passed through whole (whitespace
// collapsed); it only bounds malformed, over-long data. With MAX_CANDIDATES this
// keeps the prompt bounded.
const MAX_ANSWER_IN_PROMPT = 4000;
/** Keep the composed answer chat-sized. */
const MAX_ANSWER_LENGTH = 1200;

/** What the model returns when asked to answer from the knowledge base. */
const answerSchema = z.object({
	/** True only when the FAQs actually cover the question. */
	answered: z.boolean(),
	/** The grounded answer (empty when `answered` is false). */
	answer: z.string(),
	/** Ids of the FAQ(s) the answer draws on (a subset of those we sent). */
	faqIds: z.array(z.string()),
});

export interface FaqAnswer {
	/** Whether the knowledge base covers the question. */
	answered: boolean;
	/** The answer text, grounded in the FAQs (empty when `answered` is false). */
	answer: string;
	/** The FAQ(s) the answer is based on, so the caller can cite its source. */
	sources: FaqId[];
}

/** Minimal logger surface — compatible with `console` and Fastify's pino logger. */
export interface FaqAnswerLogger {
	warn(message: string): void;
}

export interface FaqAnswerService {
	/**
	 * Answer `input.question` using only `candidates` (the account's FAQs). Returns
	 * `{ answered: false }` when the knowledge base doesn't cover it. Never throws —
	 * a model outage degrades to a deterministic keyword match, not an error.
	 */
	answer(input: { question: string }, candidates: Faq[]): Promise<FaqAnswer>;
}

/**
 * The single AI call this service makes, narrowed to what we use. Injectable so
 * tests can drive the logic (grounding guards, fallback) without a model or the
 * network. Defaults to the AI SDK's {@link generateObject}.
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

const ANSWER_SYSTEM =
	'You are Rivus, an assistant that answers questions about a business using ONLY that ' +
	"business's knowledge base of FAQs. You are given the visitor's question and a JSON array " +
	'of FAQs ({id, question, answer, category}). If one or more FAQs answer the question — even ' +
	'when the wording differs (for example "what\'s our best price?" is answered by a "cost" or ' +
	'"rate" FAQ, and "where are you?" by an "address" or "location" FAQ) — reply with a short, ' +
	'direct, friendly answer based strictly on those FAQs, set answered=true, and list the id(s) ' +
	'you used in faqIds. Never invent prices, facts, or details that are not in the FAQs, and ' +
	'never answer from general knowledge. If the FAQs do not contain the answer, set ' +
	'answered=false, leave answer empty, and return an empty faqIds. Keep the answer concise and ' +
	'in plain language.';

/**
 * AI-backed knowledge-base answering. Tries each model in order, so callers can
 * pass a primary plus backups from other providers; if every model fails the call
 * degrades to a deterministic keyword match rather than throwing into the request
 * path.
 */
export class AiFaqAnswerService implements FaqAnswerService {
	private readonly models: LanguageModel[];
	private readonly generate: GenerateObjectFn;
	private readonly logger?: FaqAnswerLogger;

	constructor(options: {
		models: LanguageModel[];
		generate?: GenerateObjectFn;
		logger?: FaqAnswerLogger;
	}) {
		this.models = options.models;
		this.generate = options.generate ?? defaultGenerateObject;
		this.logger = options.logger;
	}

	async answer(input: { question: string }, candidates: Faq[]): Promise<FaqAnswer> {
		if (candidates.length === 0) {
			return { answered: false, answer: '', sources: [] };
		}
		// Newest-first from the caller; send the most recent so the whole knowledge
		// base of a small business is considered semantically (no keyword pre-filter,
		// which would drop matches like "best price" → a "cost" FAQ before the model
		// ever sees them).
		const shortlist = candidates.slice(0, MAX_CANDIDATES);
		const ids = new Set<string>(shortlist.map((faq) => faq.id));
		const knowledge = shortlist.map((faq) => ({
			id: faq.id,
			question: faq.question,
			answer: snippet(faq.answer, MAX_ANSWER_IN_PROMPT),
			category: faq.category,
		}));

		const result = await this.generateWithFallback({
			schema: answerSchema,
			schemaName: 'faq_answer',
			system: ANSWER_SYSTEM,
			prompt:
				`Visitor question: ${input.question}\n\n` +
				`Knowledge base FAQs (JSON array of {id, question, answer, category}):\n${JSON.stringify(knowledge)}`,
		});

		// Every model failed: fall back to a deterministic keyword match so the
		// feature still answers obvious questions when the AI is unavailable.
		if (!result) {
			return deterministicFaqAnswer(input.question, shortlist);
		}
		if (!result.answered) {
			return { answered: false, answer: '', sources: [] };
		}
		const answer = snippet(result.answer.trim(), MAX_ANSWER_LENGTH);
		if (answer === '') {
			return deterministicFaqAnswer(input.question, shortlist);
		}
		// Keep only cited ids we actually sent (guards a hallucinated/stale id); if
		// the model answered but cited nothing usable, fall back to the closest FAQ.
		const sources = result.faqIds.filter((id) => ids.has(id)) as FaqId[];
		if (sources.length === 0) {
			const [closest] = rankByKeyword(input.question, shortlist);
			return { answered: true, answer, sources: closest ? [closest.id] : [] };
		}
		return { answered: true, answer, sources };
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
			} catch (error) {
				// This provider failed — log it (so a misconfigured primary is visible in
				// production) and fall through to the next backup model.
				this.logger?.warn(
					`Knowledge-base answer: ${options.schemaName} request failed, trying next provider — ${String(error)}`,
				);
			}
		}
		return null;
	}
}

/**
 * Deterministic answer used when no model is available (no provider key set, or
 * every provider failed): the answer of the single most keyword-relevant FAQ,
 * verbatim. It can't match a question to a differently-worded FAQ the way the AI
 * can, so it returns `{ answered: false }` when nothing overlaps rather than
 * guessing.
 */
export function deterministicFaqAnswer(question: string, candidates: Faq[]): FaqAnswer {
	const [top] = rankByKeyword(question, candidates);
	if (!top) {
		return { answered: false, answer: '', sources: [] };
	}
	return {
		answered: true,
		answer: snippet(top.answer.trim(), MAX_ANSWER_LENGTH),
		sources: [top.id],
	};
}

/** A no-op-ish service: answers deterministically by keyword, with no AI. */
export class NoopFaqAnswerService implements FaqAnswerService {
	async answer(input: { question: string }, candidates: Faq[]): Promise<FaqAnswer> {
		return deterministicFaqAnswer(input.question, candidates);
	}
}

// Words too common to help a match; dropped before scoring (mirrors the agent's
// own knowledge-base ranking).
const STOPWORDS = new Set([
	'the',
	'and',
	'for',
	'our',
	'you',
	'your',
	'what',
	'whats',
	'about',
	'have',
	'does',
	'with',
	'this',
	'that',
	'are',
	'can',
	'how',
	'why',
	'who',
	'where',
	'when',
]);

/** Lowercased word tokens worth matching on (short/stopword tokens dropped). */
function tokenize(value: string): string[] {
	return (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
		(token) => token.length > 2 && !STOPWORDS.has(token),
	);
}

/** FAQs ranked by how many question tokens appear in them, best first, zeros dropped. */
function rankByKeyword(question: string, faqs: Faq[]): Faq[] {
	const tokens = tokenize(question);
	const needle = question.trim().toLowerCase();
	return faqs
		.map((faq) => {
			const haystack = `${faq.question} ${faq.answer} ${faq.category}`.toLowerCase();
			const score =
				tokens.length > 0
					? tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0)
					: needle.length > 0 && haystack.includes(needle)
						? 1
						: 0;
			return { faq, score };
		})
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score)
		.map((entry) => entry.faq);
}

/** Collapse whitespace and cap text at `max` so prompts and replies stay bounded. */
function snippet(text: string, max: number): string {
	const clean = text.replace(/\s+/g, ' ').trim();
	return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Build the knowledge-base answering service from config. Reuses the same ordered
 * provider list as the duplicate-FAQ check — OpenAI primary, then Google, xAI, and
 * Anthropic as backups. When no key is set at all, returns a
 * {@link NoopFaqAnswerService} so the feature degrades to deterministic keyword
 * matching and the API still boots.
 */
export function createFaqAnswerService(
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
): FaqAnswerService {
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
		return new NoopFaqAnswerService();
	}
	return new AiFaqAnswerService({ models, logger: console });
}

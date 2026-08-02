import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import type { Faq, FaqId } from '@rivus/core';
import {
	cosineSimilarity,
	type EmbeddingModel,
	embedMany,
	generateObject,
	type LanguageModel,
} from 'ai';
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

// --- Embedding retrieval (for knowledge bases larger than MAX_CANDIDATES) ---
// Cap the text embedded per FAQ. Embedding models accept far more, but a tight bound
// keeps cost and latency predictable — an FAQ's question plus the start of its answer
// carries the topic signal retrieval needs.
const MAX_EMBED_CHARS = 2000;
// How many FAQ vectors to keep in the in-process cache. Keyed by id + updatedAt, so an
// edited FAQ re-embeds on next use and its stale vector ages out. Sized well above any
// single request's candidate set so one large account can't evict its own vectors
// mid-rank.
const VECTOR_CACHE_CAPACITY = 5000;

/** What the model returns when asked to answer from the knowledge base. */
const answerSchema = z.object({
	/** True only when the FAQs actually cover the question. */
	answered: z.boolean(),
	/** The grounded answer (empty when `answered` is false). */
	answer: z.string(),
	/** Ids of the FAQ(s) the answer draws on (a subset of those we sent). */
	faqIds: z.array(z.string()),
});

/**
 * Where an answer's TEXT came from. `model` means a language model composed it
 * from the FAQs we sent; `keyword` means it is an FAQ's stored answer returned
 * verbatim by the deterministic matcher — which fires whenever no provider is
 * configured or every provider failed, and which matches on a single token
 * overlap. That is fine for a human picking from suggestions and far too loose
 * to text a customer unreviewed, so the provenance travels with the answer and
 * `decideRivusReply` decides what may be auto-sent.
 */
export type FaqAnswerGrounding = 'model' | 'keyword';

export interface FaqAnswer {
	/** Whether the knowledge base covers the question. */
	answered: boolean;
	/** The answer text, grounded in the FAQs (empty when `answered` is false). */
	answer: string;
	/** The FAQ(s) the answer is based on, so the caller can cite its source. */
	sources: FaqId[];
	/** How the answer text was produced — `keyword` whenever no model wrote it. */
	grounding: FaqAnswerGrounding;
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
 * Narrows a candidate set down to the FAQs most relevant to a question before they're
 * sent to the model. The answer service caps how many FAQs it can prompt with; for a
 * small business that's the whole knowledge base, but once an account grows past the
 * cap, picking the newest FAQs can miss the answer if it lives in an older one.
 * A retriever ranks by *relevance* instead, so the right FAQs survive the cap.
 */
export interface FaqRetriever {
	/**
	 * Return up to `limit` of `candidates` most relevant to `query`, best first. Never
	 * throws — an embedding outage degrades to the first `limit` (newest) candidates.
	 */
	retrieve(query: string, candidates: Faq[], limit: number): Promise<Faq[]>;
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
	private readonly retriever?: FaqRetriever;

	constructor(options: {
		models: LanguageModel[];
		generate?: GenerateObjectFn;
		logger?: FaqAnswerLogger;
		/**
		 * Optional semantic retriever. When set and the candidate set is larger than the
		 * prompt cap, the most *relevant* FAQs are sent to the model instead of the
		 * newest. When absent, the newest are used (the small-business default).
		 */
		retriever?: FaqRetriever;
	}) {
		this.models = options.models;
		this.generate = options.generate ?? defaultGenerateObject;
		this.logger = options.logger;
		this.retriever = options.retriever;
	}

	async answer(input: { question: string }, candidates: Faq[]): Promise<FaqAnswer> {
		if (candidates.length === 0) {
			// No model ran, so nothing here is model-grounded.
			return { answered: false, answer: '', sources: [], grounding: 'keyword' };
		}
		const shortlist = await this.shortlist(input.question, candidates);
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
			// The model read the knowledge base and said it doesn't cover this.
			return { answered: false, answer: '', sources: [], grounding: 'model' };
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
			// The citation was recovered by keyword, but the model still wrote the text.
			return { answered: true, answer, sources: closest ? [closest.id] : [], grounding: 'model' };
		}
		return { answered: true, answer, sources, grounding: 'model' };
	}

	/**
	 * Pick the FAQs to ground the answer in. For a small knowledge base (at or under
	 * the prompt cap) that's all of them, newest-first — the existing behavior, with no
	 * embedding cost. For a larger one, a configured retriever ranks by relevance so an
	 * answer living in an older FAQ isn't dropped just for being old; without a
	 * retriever we keep the newest, exactly as before.
	 */
	private async shortlist(question: string, candidates: Faq[]): Promise<Faq[]> {
		if (!this.retriever || candidates.length <= MAX_CANDIDATES) {
			return candidates.slice(0, MAX_CANDIDATES);
		}
		return this.retriever.retrieve(question, candidates, MAX_CANDIDATES);
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

/* -------------------------------------------------------------------------- */
/* Embedding-based retrieval                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The single embedding call this retriever makes, narrowed to what we use. Injectable
 * so tests can drive ranking and the cache without a model or the network. Defaults to
 * the AI SDK's {@link embedMany}.
 */
export type EmbedManyFn = (options: {
	model: EmbeddingModel;
	values: string[];
}) => Promise<{ embeddings: number[][] }>;

const defaultEmbedMany: EmbedManyFn = async (options) => {
	const { embeddings } = await embedMany({ model: options.model, values: options.values });
	return { embeddings };
};

/**
 * A tiny bounded LRU cache for FAQ vectors. Keyed by `${id}:${updatedAt}` so a vector
 * is reused across answers, but a fresh edit (new `updatedAt`) misses and re-embeds —
 * the "refresh" half of storing vectors. Capacity-bounded so a long-lived process
 * can't grow it without limit; the least-recently-used entry is evicted first.
 */
class VectorCache {
	private readonly store = new Map<string, number[]>();

	constructor(private readonly capacity: number) {}

	get(key: string): number[] | undefined {
		const value = this.store.get(key);
		if (value !== undefined) {
			// Re-insert so it counts as most-recently-used.
			this.store.delete(key);
			this.store.set(key, value);
		}
		return value;
	}

	set(key: string, value: number[]): void {
		this.store.delete(key);
		this.store.set(key, value);
		if (this.store.size > this.capacity) {
			const oldest = this.store.keys().next().value;
			if (oldest !== undefined) {
				this.store.delete(oldest);
			}
		}
	}
}

/** The cache key for an FAQ: its id plus the timestamp that changes on every edit. */
function vectorCacheKey(faq: Faq): string {
	return `${faq.id}:${faq.updatedAt}`;
}

/** The text embedded for an FAQ — question, answer, and category carry the topic. */
function faqEmbeddingText(faq: Faq): string {
	return snippet(`${faq.question}\n${faq.answer}\n${faq.category}`, MAX_EMBED_CHARS);
}

/**
 * Semantic retrieval over a candidate set using text embeddings. The question and each
 * not-yet-cached FAQ are embedded in a single batch; FAQs are then ranked by cosine
 * similarity to the question and the top `limit` returned. FAQ vectors are cached
 * (keyed by id + `updatedAt`) so repeat questions don't re-embed and edits refresh on
 * their own. Any failure degrades to the newest `limit` candidates — retrieval is an
 * optimization, never a hard dependency of answering.
 */
export class EmbeddingFaqRetriever implements FaqRetriever {
	private readonly model: EmbeddingModel;
	private readonly embed: EmbedManyFn;
	private readonly logger?: FaqAnswerLogger;
	private readonly cache: VectorCache;

	constructor(options: {
		model: EmbeddingModel;
		embed?: EmbedManyFn;
		logger?: FaqAnswerLogger;
		cacheCapacity?: number;
	}) {
		this.model = options.model;
		this.embed = options.embed ?? defaultEmbedMany;
		this.logger = options.logger;
		this.cache = new VectorCache(options.cacheCapacity ?? VECTOR_CACHE_CAPACITY);
	}

	async retrieve(query: string, candidates: Faq[], limit: number): Promise<Faq[]> {
		// Nothing to gain: the model would see them all anyway, so skip embedding.
		if (candidates.length <= limit) {
			return candidates.slice(0, limit);
		}
		try {
			// Resolve a vector for every candidate, embedding only cache misses. The query
			// rides in the same batch (always a miss — questions vary) at index 0.
			const vectors = new Map<string, number[]>();
			const misses: Faq[] = [];
			for (const faq of candidates) {
				const cached = this.cache.get(vectorCacheKey(faq));
				if (cached) {
					vectors.set(faq.id, cached);
				} else {
					misses.push(faq);
				}
			}
			const { embeddings } = await this.embed({
				model: this.model,
				values: [query, ...misses.map(faqEmbeddingText)],
			});
			const queryVector = embeddings[0];
			if (!queryVector) {
				return candidates.slice(0, limit);
			}
			misses.forEach((faq, index) => {
				const vector = embeddings[index + 1];
				if (vector) {
					this.cache.set(vectorCacheKey(faq), vector);
					vectors.set(faq.id, vector);
				}
			});
			return candidates
				.map((faq) => {
					const vector = vectors.get(faq.id);
					// A candidate left without a vector (a short embedding batch) sinks below
					// any scored one, but stays eligible if the limit isn't otherwise filled.
					const score = vector ? cosineSimilarity(queryVector, vector) : Number.NEGATIVE_INFINITY;
					return { faq, score };
				})
				.sort((a, b) => b.score - a.score)
				.slice(0, limit)
				.map((entry) => entry.faq);
		} catch (error) {
			// Retrieval is best-effort: log and fall back to the newest candidates so a
			// flaky embeddings provider degrades to recency rather than failing the answer.
			this.logger?.warn(
				`Knowledge-base answer: embedding retrieval failed, using newest FAQs — ${String(error)}`,
			);
			return candidates.slice(0, limit);
		}
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
		return { answered: false, answer: '', sources: [], grounding: 'keyword' };
	}
	return {
		answered: true,
		answer: snippet(top.answer.trim(), MAX_ANSWER_LENGTH),
		sources: [top.id],
		grounding: 'keyword',
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
 * Build the embedding retriever from config, or undefined when no embeddings provider
 * is configured (the answer service then keeps its newest-first behavior). The query
 * and FAQs must be embedded by the same model, so retrieval uses a single provider:
 * OpenAI when its key is set, otherwise Google. xAI and Anthropic have no first-party
 * text-embedding model in the AI SDK, so they don't serve retrieval.
 */
export function createFaqRetriever(
	config: Pick<
		Config,
		| 'OPENAI_API_KEY'
		| 'OPENAI_EMBEDDING_MODEL'
		| 'GOOGLE_GENERATIVE_AI_API_KEY'
		| 'GOOGLE_EMBEDDING_MODEL'
	>,
): FaqRetriever | undefined {
	if (config.OPENAI_API_KEY) {
		const model = createOpenAI({ apiKey: config.OPENAI_API_KEY }).textEmbeddingModel(
			config.OPENAI_EMBEDDING_MODEL,
		);
		return new EmbeddingFaqRetriever({ model, logger: console });
	}
	if (config.GOOGLE_GENERATIVE_AI_API_KEY) {
		const model = createGoogleGenerativeAI({
			apiKey: config.GOOGLE_GENERATIVE_AI_API_KEY,
		}).textEmbeddingModel(config.GOOGLE_EMBEDDING_MODEL);
		return new EmbeddingFaqRetriever({ model, logger: console });
	}
	return undefined;
}

/**
 * Build the knowledge-base answering service from config. Reuses the same ordered
 * provider list as the duplicate-FAQ check — OpenAI primary, then Google, xAI, and
 * Anthropic as backups. For accounts whose knowledge base outgrows the prompt cap, an
 * embedding retriever (when a provider supports embeddings) ranks FAQs by relevance so
 * the answer isn't missed just because it lives in an older FAQ. When no key is set at
 * all, returns a {@link NoopFaqAnswerService} so the feature degrades to deterministic
 * keyword matching and the API still boots.
 */
export function createFaqAnswerService(
	config: Pick<
		Config,
		| 'OPENAI_API_KEY'
		| 'OPENAI_MODEL'
		| 'OPENAI_EMBEDDING_MODEL'
		| 'GOOGLE_GENERATIVE_AI_API_KEY'
		| 'GEMINI_MODEL'
		| 'GOOGLE_EMBEDDING_MODEL'
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
	return new AiFaqAnswerService({ models, logger: console, retriever: createFaqRetriever(config) });
}

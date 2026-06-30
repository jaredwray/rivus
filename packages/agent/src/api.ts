import {
	type Account,
	type AccountId,
	accountStatusSchema,
	type CreateFaqInput,
	type Faq,
	type FaqId,
	faqStatusSchema,
	roleSchema,
	type UpdateFaqInput,
	type User,
	type UserId,
} from '@rivus/core';
import { z } from 'zod';

/**
 * The slice of the Rivus REST API the agent uses on a signed-in user's behalf.
 *
 * The agent never touches the database directly — all tenant data lives behind
 * `@rivus/api`. So once a request is authenticated, the agent acts as a client
 * of that API, forwarding the user's token as a bearer header. The API therefore
 * stays the single source of truth and enforces tenancy (account scoping) and
 * permissions (role checks) exactly as it does for the app; the agent just
 * orchestrates and formats. Responses are Zod-validated so callers get trusted,
 * well-typed data — mirroring the app's own API client.
 */

export type FetchLike = typeof globalThis.fetch;

/** Error thrown for any non-2xx API response, carrying the HTTP status. */
export class AgentApiError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = 'AgentApiError';
		this.status = status;
	}
}

// `@rivus/core` brands its ids (a `FaqId` can't be passed where a `UserId` is
// expected). The wire format is a plain string; this casts the string schema so
// the *inferred* output keeps the brand, exactly as the app's API client does.
const branded = <T>() => z.string().min(1) as unknown as z.ZodType<T>;

const userSchema = z.object({
	id: branded<UserId>(),
	email: z.string(),
	name: z.string(),
	avatarUrl: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
}) satisfies z.ZodType<User>;

const accountSchema = z.object({
	id: branded<AccountId>(),
	name: z.string(),
	slug: z.string(),
	phone: z.string(),
	address: z.string(),
	website: z.string(),
	timezone: z.string(),
	// Reuse the core enums so the agent never drifts from the API's source of truth.
	status: accountStatusSchema,
	canceledAt: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
}) satisfies z.ZodType<Account>;

const sessionSchema = z.object({
	user: userSchema,
	account: accountSchema,
	role: roleSchema,
});
export type SessionView = z.infer<typeof sessionSchema>;

const faqSchema = z.object({
	id: branded<FaqId>(),
	accountId: branded<AccountId>(),
	question: z.string(),
	answer: z.string(),
	category: z.string(),
	status: faqStatusSchema,
	createdAt: z.string(),
	updatedAt: z.string(),
}) satisfies z.ZodType<Faq>;

const paginationMetaSchema = z.object({
	page: z.number().int(),
	pageSize: z.number().int(),
	total: z.number().int(),
	totalPages: z.number().int(),
	hasNextPage: z.boolean(),
	hasPreviousPage: z.boolean(),
});

const faqListSchema = z.object({
	data: z.array(faqSchema),
	meta: paginationMetaSchema,
});
export type FaqListResult = z.infer<typeof faqListSchema>;

const faqSimilaritySchema = z.object({
	match: faqSchema.nullable(),
	reason: z.string(),
	merged: z.object({ question: z.string(), answer: z.string() }).nullable(),
});
export type FaqSimilarityResult = z.infer<typeof faqSimilaritySchema>;

const faqAnswerSchema = z.object({
	answered: z.boolean(),
	answer: z.string(),
	sources: z.array(z.object({ id: branded<FaqId>(), question: z.string() })),
});
export type FaqAnswerResult = z.infer<typeof faqAnswerSchema>;

const errorBodySchema = z.object({
	error: z.string().optional(),
	message: z.string().optional(),
	statusCode: z.number().optional(),
});

/** Options for {@link RivusApiClient.listFaqs}. */
export interface ListFaqsQuery {
	page?: number;
	pageSize?: number;
}

export interface RivusApiClient {
	/** The current session: the user, their company, and their role. */
	me(): Promise<SessionView>;
	/** A page of the account's FAQs (the knowledge base). */
	listFaqs(query?: ListFaqsQuery): Promise<FaqListResult>;
	/** Apply a partial update to one FAQ. */
	updateFaq(id: FaqId, patch: UpdateFaqInput): Promise<Faq>;
	/** Create a new FAQ. */
	createFaq(input: CreateFaqInput): Promise<Faq>;
	/**
	 * Ask whether a semantically similar FAQ already exists (AI-assisted), before
	 * creating one. Returns `{ match: null }` when nothing similar is found — or
	 * always, when the API has no AI provider configured.
	 */
	findSimilarFaq(input: { question: string; answer?: string }): Promise<FaqSimilarityResult>;
	/**
	 * Answer a free-text question from the account's knowledge base (AI-assisted).
	 * Returns `{ answered: false }` when the FAQs don't cover the question, so the
	 * agent can fall back to a friendly nudge instead of guessing.
	 */
	answerFromKnowledge(input: { question: string }): Promise<FaqAnswerResult>;
}

/** Strip a single trailing slash so `${base}${path}` never doubles up. */
function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, '');
}

function safeJsonParse(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

/**
 * Build a Rivus API client bound to a signed-in user's bearer `token`. Every
 * request carries `Authorization: Bearer <token>`, so the API authenticates and
 * authorizes as if the user called it directly.
 */
export function createRivusApiClient(
	baseUrl: string,
	token: string,
	fetchImpl: FetchLike = fetch,
): RivusApiClient {
	const root = normalizeBaseUrl(baseUrl);

	async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
		const response = await fetchImpl(`${root}${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${token}`,
				...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
				...init?.headers,
			},
		});
		const raw = await response.text();
		const body = raw.length > 0 ? safeJsonParse(raw) : undefined;

		if (!response.ok) {
			const parsed = errorBodySchema.safeParse(body);
			const message =
				(parsed.success && parsed.data.message) ||
				`Rivus API request to ${path} failed with status ${response.status}`;
			throw new AgentApiError(message, response.status);
		}

		return schema.parse(body);
	}

	return {
		me() {
			return request('/v1/auth/me', sessionSchema, { method: 'GET' });
		},

		listFaqs(query?: ListFaqsQuery) {
			const search = new URLSearchParams({
				page: String(query?.page ?? 1),
				pageSize: String(query?.pageSize ?? 20),
			});
			return request(`/v1/faqs?${search.toString()}`, faqListSchema, { method: 'GET' });
		},

		updateFaq(id: FaqId, patch: UpdateFaqInput) {
			return request(`/v1/faqs/${encodeURIComponent(id)}`, faqSchema, {
				method: 'PATCH',
				body: JSON.stringify(patch),
			});
		},

		createFaq(input: CreateFaqInput) {
			return request('/v1/faqs', faqSchema, {
				method: 'POST',
				body: JSON.stringify(input),
			});
		},

		findSimilarFaq(input: { question: string; answer?: string }) {
			return request('/v1/faqs/similar', faqSimilaritySchema, {
				method: 'POST',
				body: JSON.stringify({ question: input.question, answer: input.answer ?? '' }),
			});
		},

		answerFromKnowledge(input: { question: string }) {
			return request('/v1/faqs/answer', faqAnswerSchema, {
				method: 'POST',
				body: JSON.stringify({ question: input.question }),
			});
		},
	};
}

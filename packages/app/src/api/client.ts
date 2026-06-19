import {
	type Item,
	type ItemId,
	itemStatusSchema,
	type LoginInput,
	loginSchema,
	type PaginationMeta,
	type PaginationQuery,
	paginationQuerySchema,
	type RegisterInput,
	registerSchema,
	type User,
	type UserId,
} from '@rivus/core';
import { z } from 'zod';

// `@rivus/core` brands its ids (`ItemId`/`UserId`) so a user id can't be passed
// where an item id is expected. The wire format is a plain string; these helpers
// validate as strings while preserving the brand in the inferred type.
const itemId = () => z.string().min(1) as unknown as z.ZodType<ItemId>;
const userId = () => z.string().min(1) as unknown as z.ZodType<UserId>;

/**
 * Pure, runtime-agnostic API client for the Rivus REST API.
 *
 * It deliberately imports nothing from `react-native`/`expo`, so it can run
 * under plain Node (and be unit-tested with a mocked `fetch`). Shared request
 * shapes are validated with the Zod schemas exported by `@rivus/core`, and
 * responses are parsed so callers receive well-typed, trusted data.
 */

/** Error thrown for any non-2xx response, carrying the HTTP status. */
export class ApiError extends Error {
	readonly status: number;
	readonly details?: unknown;

	constructor(message: string, status: number, details?: unknown) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.details = details;
	}
}

// --- Response schemas (mirror @rivus/api http-schemas; app depends on core only).

const userResponseSchema = z.object({
	id: z.string(),
	email: z.string(),
	name: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

const authResponseSchema = z.object({
	token: z.string(),
	user: userResponseSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

const itemResponseSchema = z.object({
	id: itemId(),
	ownerId: userId(),
	name: z.string(),
	description: z.string(),
	status: itemStatusSchema,
	createdAt: z.string(),
	updatedAt: z.string(),
}) satisfies z.ZodType<Item>;

const paginationMetaSchema = z.object({
	page: z.number().int(),
	pageSize: z.number().int(),
	total: z.number().int(),
	totalPages: z.number().int(),
	hasNextPage: z.boolean(),
	hasPreviousPage: z.boolean(),
});

const itemListResponseSchema = z.object({
	data: z.array(itemResponseSchema),
	meta: paginationMetaSchema,
});

export interface ItemListResponse {
	data: Item[];
	meta: PaginationMeta;
}

const healthResponseSchema = z.object({
	status: z.literal('ok'),
	uptime: z.number(),
	timestamp: z.string(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

const errorBodySchema = z.object({
	error: z.string().optional(),
	message: z.string().optional(),
	statusCode: z.number().optional(),
	details: z.unknown().optional(),
});

export type FetchLike = typeof globalThis.fetch;

export interface RivusApiClient {
	readonly baseUrl: string;
	health(): Promise<HealthResponse>;
	login(input: LoginInput): Promise<AuthResponse>;
	register(input: RegisterInput): Promise<AuthResponse>;
	listItems(token: string, query?: Partial<PaginationQuery>): Promise<ItemListResponse>;
}

/** Strip a single trailing slash so `${base}${path}` never doubles up. */
function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, '');
}

export function createApiClient(baseUrl: string, fetchImpl: FetchLike = fetch): RivusApiClient {
	const root = normalizeBaseUrl(baseUrl);

	/** Perform a request, parse JSON, and turn non-2xx into a typed ApiError. */
	async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
		const response = await fetchImpl(`${root}${path}`, init);
		const raw = await response.text();
		const body = raw.length > 0 ? safeJsonParse(raw) : undefined;

		if (!response.ok) {
			const parsed = errorBodySchema.safeParse(body);
			const message =
				(parsed.success && parsed.data.message) ||
				`Request to ${path} failed with status ${response.status}`;
			const details = parsed.success ? parsed.data.details : body;
			throw new ApiError(message, response.status, details);
		}

		return schema.parse(body);
	}

	function authHeaders(token: string): Record<string, string> {
		return { Authorization: `Bearer ${token}` };
	}

	return {
		baseUrl: root,

		health() {
			return request('/health', healthResponseSchema, { method: 'GET' });
		},

		// `async` so input-validation errors surface as a rejected promise
		// (the expected async contract) rather than a synchronous throw.
		async login(input: LoginInput) {
			const payload = loginSchema.parse(input);
			return request('/v1/auth/login', authResponseSchema, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});
		},

		async register(input: RegisterInput) {
			const payload = registerSchema.parse(input);
			return request('/v1/auth/register', authResponseSchema, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});
		},

		async listItems(token: string, query?: Partial<PaginationQuery>) {
			const { page, pageSize } = paginationQuerySchema.parse(query ?? {});
			const search = new URLSearchParams({
				page: String(page),
				pageSize: String(pageSize),
			});
			return request(`/v1/items?${search.toString()}`, itemListResponseSchema, {
				method: 'GET',
				headers: authHeaders(token),
			});
		},
	};
}

function safeJsonParse(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

export type { Item, PaginationMeta, User };

import {
	type AcceptInviteInput,
	type Account,
	type AccountId,
	acceptInviteSchema,
	type InviteMemberInput,
	type Item,
	type ItemId,
	inviteMemberSchema,
	itemStatusSchema,
	type LoginInput,
	loginSchema,
	type PaginationMeta,
	type PaginationQuery,
	paginationQuerySchema,
	type Role,
	roleSchema,
	signupSchema,
	type User,
	type UserId,
	type VerifyCodeInput,
	verifyCodeSchema,
} from '@rivus/core';
import { z } from 'zod';

/** Signup accepts the schema's *input* (business defaults like timezone optional). */
export type SignupBody = z.input<typeof signupSchema>;

// `@rivus/core` brands its ids so a user id can't be passed where an item id is
// expected. The wire format is a plain string; these helpers validate as strings
// while preserving the brand in the inferred type.
const itemId = () => z.string().min(1) as unknown as z.ZodType<ItemId>;
const accountId = () => z.string().min(1) as unknown as z.ZodType<AccountId>;
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

/**
 * Thrown when a request body fails client-side validation before any network
 * call. Its `message` is a single, human-readable line (the first issue), so UI
 * that surfaces `error.message` shows friendly text — not the raw JSON array
 * that `ZodError.message` serializes to. The full field-level `issues` are kept
 * for callers that want to highlight individual inputs.
 */
export class ValidationError extends Error {
	readonly issues: z.ZodError['issues'];

	constructor(message: string, issues: z.ZodError['issues']) {
		super(message);
		this.name = 'ValidationError';
		this.issues = issues;
	}
}

/**
 * Validate request input, raising a friendly {@link ValidationError} on failure.
 * Wraps `schema.safeParse` so a bad field never escapes as a `ZodError` (whose
 * `.message` is a JSON dump that would land verbatim in the UI).
 */
function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
	const result = schema.safeParse(input);
	if (!result.success) {
		const message =
			result.error.issues[0]?.message ?? 'Please check the details you entered and try again.';
		throw new ValidationError(message, result.error.issues);
	}
	return result.data;
}

// --- Response schemas (mirror @rivus/api http-schemas; app depends on core only).

const userResponseSchema = z.object({
	id: z.string(),
	email: z.string(),
	name: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

const accountResponseSchema = z.object({
	id: accountId(),
	name: z.string(),
	slug: z.string(),
	phone: z.string(),
	address: z.string(),
	website: z.string(),
	timezone: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
}) satisfies z.ZodType<Account>;

const authResponseSchema = z.object({
	token: z.string(),
	user: userResponseSchema,
	account: accountResponseSchema,
	role: roleSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

// Signup and login are passwordless: they email a one-time code and return this
// acknowledgement; `verifyCode` then exchanges the code for an `AuthResponse`.
const codeSentResponseSchema = z.object({
	status: z.literal('code_sent'),
	email: z.string(),
});
export type CodeSentResponse = z.infer<typeof codeSentResponseSchema>;

const sessionResponseSchema = z.object({
	user: userResponseSchema,
	account: accountResponseSchema,
	role: roleSchema,
});
export type Session = z.infer<typeof sessionResponseSchema>;

const memberResponseSchema = z.object({
	userId: userId(),
	email: z.string(),
	name: z.string(),
	role: roleSchema,
	joinedAt: z.string(),
});
export type Member = z.infer<typeof memberResponseSchema>;

// Roster view — the bearer token is intentionally absent (the API never leaks it
// to members who can list the roster).
const inviteSummarySchema = z.object({
	id: z.string(),
	email: z.string(),
	name: z.string(),
	role: z.enum(['manager', 'team_member']),
	status: z.enum(['pending', 'accepted', 'revoked']),
	createdAt: z.string(),
});
export type InviteSummary = z.infer<typeof inviteSummarySchema>;

// Creator view — includes the shareable token (returned only from inviteMember).
const inviteResponseSchema = inviteSummarySchema.extend({ token: z.string() });
export type Invite = z.infer<typeof inviteResponseSchema>;

const memberListResponseSchema = z.object({
	members: z.array(memberResponseSchema),
	invites: z.array(inviteSummarySchema),
});
export type MemberList = z.infer<typeof memberListResponseSchema>;

const itemResponseSchema = z.object({
	id: itemId(),
	accountId: accountId(),
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
	/** Begin signup — emails a one-time code to confirm the address. */
	signup(input: SignupBody): Promise<CodeSentResponse>;
	/** Request a one-time sign-in code for an existing account. */
	login(input: LoginInput): Promise<CodeSentResponse>;
	/** Exchange a one-time code (signup or login) for a session. */
	verifyCode(input: VerifyCodeInput): Promise<AuthResponse>;
	acceptInvite(input: AcceptInviteInput): Promise<AuthResponse>;
	me(token: string): Promise<Session>;
	listMembers(token: string): Promise<MemberList>;
	inviteMember(token: string, input: InviteMemberInput): Promise<Invite>;
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

	function jsonInit(method: string, payload: unknown, token?: string): RequestInit {
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (token) {
			headers.Authorization = `Bearer ${token}`;
		}
		return { method, headers, body: JSON.stringify(payload) };
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
		async signup(input: SignupBody) {
			const payload = parseInput(signupSchema, input);
			return request('/v1/auth/signup', codeSentResponseSchema, jsonInit('POST', payload));
		},

		async login(input: LoginInput) {
			const payload = parseInput(loginSchema, input);
			return request('/v1/auth/login', codeSentResponseSchema, jsonInit('POST', payload));
		},

		async verifyCode(input: VerifyCodeInput) {
			const payload = parseInput(verifyCodeSchema, input);
			return request('/v1/auth/verify', authResponseSchema, jsonInit('POST', payload));
		},

		async acceptInvite(input: AcceptInviteInput) {
			const payload = parseInput(acceptInviteSchema, input);
			return request('/v1/auth/accept-invite', authResponseSchema, jsonInit('POST', payload));
		},

		me(token: string) {
			return request('/v1/auth/me', sessionResponseSchema, {
				method: 'GET',
				headers: authHeaders(token),
			});
		},

		listMembers(token: string) {
			return request('/v1/members', memberListResponseSchema, {
				method: 'GET',
				headers: authHeaders(token),
			});
		},

		async inviteMember(token: string, input: InviteMemberInput) {
			const payload = parseInput(inviteMemberSchema, input);
			return request('/v1/members/invites', inviteResponseSchema, jsonInit('POST', payload, token));
		},

		async listItems(token: string, query?: Partial<PaginationQuery>) {
			const { page, pageSize } = parseInput(paginationQuerySchema, query ?? {});
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

export type { Account, Item, PaginationMeta, Role, User };

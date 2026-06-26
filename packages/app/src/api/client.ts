import {
	type AcceptInviteInput,
	type Account,
	type AccountId,
	acceptInviteSchema,
	accountStatusSchema,
	type Customer,
	type CustomerId,
	createCustomerSchema,
	createFaqSchema,
	customerStatusSchema,
	type Faq,
	type FaqId,
	faqSimilarityQuerySchema,
	faqStatusSchema,
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
	type UpdateAccountInput,
	type UpdateCustomerInput,
	type UpdateFaqInput,
	type User,
	type UserId,
	updateAccountSchema,
	updateCustomerSchema,
	updateFaqSchema,
	type VerifyCodeInput,
	verifyCodeSchema,
} from '@rivus/core';
import { z } from 'zod';

/** Signup accepts the schema's *input* (business defaults like timezone optional). */
export type SignupBody = z.input<typeof signupSchema>;

/**
 * createFaq accepts the schema's *input*: `category` and `status` have schema
 * defaults the API fills, so callers may omit them (don't force the parsed
 * *output* type, which would make them required).
 */
export type CreateFaqBody = z.input<typeof createFaqSchema>;

/**
 * createCustomer accepts the schema's *input*: every field except `name` has a
 * schema default the API fills, so callers may pass just `{ name }`.
 */
export type CreateCustomerBody = z.input<typeof createCustomerSchema>;

// `@rivus/core` brands its ids so a user id can't be passed where an item id is
// expected. The wire format is a plain string; these helpers validate as strings
// while preserving the brand in the inferred type.
const itemId = () => z.string().min(1) as unknown as z.ZodType<ItemId>;
const faqId = () => z.string().min(1) as unknown as z.ZodType<FaqId>;
const customerId = () => z.string().min(1) as unknown as z.ZodType<CustomerId>;
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
	status: accountStatusSchema,
	canceledAt: z.string().nullable(),
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

const signedOutResponseSchema = z.object({
	status: z.literal('signed_out'),
});

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
	role: roleSchema,
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

// Billing placeholder — no payment provider is wired up yet, so every account is
// on the free plan and `seats` mirrors the member count.
const billingResponseSchema = z.object({
	plan: z.literal('free'),
	status: accountStatusSchema,
	seats: z.number().int(),
});
export type Billing = z.infer<typeof billingResponseSchema>;

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

const faqResponseSchema = z.object({
	id: faqId(),
	accountId: accountId(),
	question: z.string(),
	answer: z.string(),
	category: z.string(),
	status: faqStatusSchema,
	createdAt: z.string(),
	updatedAt: z.string(),
}) satisfies z.ZodType<Faq>;

const faqListResponseSchema = z.object({
	data: z.array(faqResponseSchema),
	meta: paginationMetaSchema,
});

export interface FaqListResponse {
	data: Faq[];
	meta: PaginationMeta;
}

const customerResponseSchema = z.object({
	id: customerId(),
	accountId: accountId(),
	name: z.string(),
	email: z.string(),
	phone: z.string(),
	area: z.string(),
	status: customerStatusSchema,
	lifetimeValue: z.number().int(),
	balance: z.number().int(),
	notes: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
}) satisfies z.ZodType<Customer>;

const customerListResponseSchema = z.object({
	data: z.array(customerResponseSchema),
	meta: paginationMetaSchema,
});

export interface CustomerListResponse {
	data: Customer[];
	meta: PaginationMeta;
}

const faqSimilarityResponseSchema = z.object({
	match: faqResponseSchema.nullable(),
	reason: z.string(),
	merged: z.object({ question: z.string(), answer: z.string() }).nullable(),
});

/** Result of the pre-create duplicate check (see {@link RivusApiClient.findSimilarFaq}). */
export interface FaqSimilarityResult {
	/** The existing FAQ a new one would duplicate, or null when none is similar. */
	match: Faq | null;
	/** One short sentence explaining the match (empty when there is none). */
	reason: string;
	/** AI-combined question/answer to offer as an update (null when no match). */
	merged: { question: string; answer: string } | null;
}

// A 204 No Content response (FAQ delete) has an empty body; the request helper
// passes `undefined` to the schema, so accept exactly that.
const noContentSchema = z.undefined();

// A page of companies (accounts) for the staff company switcher.
const accountListResponseSchema = z.object({
	data: z.array(accountResponseSchema),
	meta: paginationMetaSchema,
});

export interface CompanyListResponse {
	data: Account[];
	meta: PaginationMeta;
}

/** Query for {@link RivusApiClient.listCompanies}: pagination plus a name/slug search. */
export type CompanyListQuery = Partial<PaginationQuery> & { search?: string };

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
	/**
	 * Return the current session. The token is optional: web clients authenticate
	 * via the session cookie (sent automatically in credentials mode), so they call
	 * this with no argument to rehydrate after a reload.
	 */
	me(token?: string): Promise<Session>;
	/** Clear the server-side session cookie (web sign-out). */
	logout(): Promise<void>;
	listMembers(token: string): Promise<MemberList>;
	inviteMember(token: string, input: InviteMemberInput): Promise<Invite>;
	/** Update the account's business settings (owner only). */
	updateAccount(token: string, input: UpdateAccountInput): Promise<Account>;
	/** Cancel (soft-delete) the account (owner only). */
	cancelAccount(token: string): Promise<Account>;
	/** Read the account's billing summary (owner only). */
	getBilling(token: string): Promise<Billing>;
	listItems(token: string, query?: Partial<PaginationQuery>): Promise<ItemListResponse>;
	/** List the account's FAQs (the knowledge base Rivus answers from). */
	listFaqs(token: string, query?: Partial<PaginationQuery>): Promise<FaqListResponse>;
	/** Create an FAQ for the account. */
	createFaq(token: string, input: CreateFaqBody): Promise<Faq>;
	/**
	 * Ask the API whether a semantically similar FAQ already exists (AI-assisted),
	 * before creating a new one. Returns the closest existing FAQ plus an AI-merged
	 * suggestion, or `{ match: null }` when nothing similar is found.
	 */
	findSimilarFaq(
		token: string,
		input: { question: string; answer?: string },
	): Promise<FaqSimilarityResult>;
	/** Update one of the account's FAQs. */
	updateFaq(token: string, id: FaqId, input: UpdateFaqInput): Promise<Faq>;
	/** Delete one of the account's FAQs. */
	deleteFaq(token: string, id: FaqId): Promise<void>;
	/** List the account's customers (CRM contacts). */
	listCustomers(token: string, query?: Partial<PaginationQuery>): Promise<CustomerListResponse>;
	/** Create a customer for the account. */
	createCustomer(token: string, input: CreateCustomerBody): Promise<Customer>;
	/** Fetch one of the account's customers. */
	getCustomer(token: string, id: CustomerId): Promise<Customer>;
	/** Update one of the account's customers. */
	updateCustomer(token: string, id: CustomerId, input: UpdateCustomerInput): Promise<Customer>;
	/** Delete one of the account's customers. */
	deleteCustomer(token: string, id: CustomerId): Promise<void>;
	/**
	 * List/search every company, for the staff company switcher. Restricted to Rivus
	 * staff server-side (a regular customer gets 403).
	 */
	listCompanies(token: string, query?: CompanyListQuery): Promise<CompanyListResponse>;
	/**
	 * Switch the active company to `accountId`, returning a fresh session scoped to
	 * it (Rivus staff only). On web the API also sets the new session cookie.
	 */
	switchCompany(token: string, accountId: AccountId): Promise<AuthResponse>;
}

/** Strip a single trailing slash so `${base}${path}` never doubles up. */
function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, '');
}

/** Optional knobs for {@link createApiClient}. */
export interface ApiClientOptions {
	/**
	 * Send cookies with every request (`credentials: 'include'`). Web clients use
	 * this so the API's HttpOnly session cookie rides along; the bearer token then
	 * becomes optional and is omitted when empty. Native clients leave this off and
	 * authenticate with the bearer header.
	 */
	withCredentials?: boolean;
}

export function createApiClient(
	baseUrl: string,
	fetchImpl: FetchLike = fetch,
	options: ApiClientOptions = {},
): RivusApiClient {
	const root = normalizeBaseUrl(baseUrl);
	const credentials: RequestCredentials | undefined = options.withCredentials
		? 'include'
		: undefined;

	/** Perform a request, parse JSON, and turn non-2xx into a typed ApiError. */
	async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
		const response = await fetchImpl(
			`${root}${path}`,
			credentials ? { ...init, credentials } : init,
		);
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

	// Only attach a bearer header when there's actually a token. In web cookie mode
	// the token is empty, and sending `Authorization: Bearer ` (malformed) would make
	// the API reject the request instead of falling back to the session cookie.
	function authHeaders(token?: string): Record<string, string> {
		return token ? { Authorization: `Bearer ${token}` } : {};
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

		me(token?: string) {
			return request('/v1/auth/me', sessionResponseSchema, {
				method: 'GET',
				headers: authHeaders(token),
			});
		},

		async logout() {
			await request('/v1/auth/logout', signedOutResponseSchema, { method: 'POST' });
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

		async updateAccount(token: string, input: UpdateAccountInput) {
			const payload = parseInput(updateAccountSchema, input);
			return request('/v1/account', accountResponseSchema, jsonInit('PATCH', payload, token));
		},

		cancelAccount(token: string) {
			return request('/v1/account/cancel', accountResponseSchema, {
				method: 'POST',
				headers: authHeaders(token),
			});
		},

		getBilling(token: string) {
			return request('/v1/billing', billingResponseSchema, {
				method: 'GET',
				headers: authHeaders(token),
			});
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

		async listFaqs(token: string, query?: Partial<PaginationQuery>) {
			const { page, pageSize } = parseInput(paginationQuerySchema, query ?? {});
			const search = new URLSearchParams({
				page: String(page),
				pageSize: String(pageSize),
			});
			return request(`/v1/faqs?${search.toString()}`, faqListResponseSchema, {
				method: 'GET',
				headers: authHeaders(token),
			});
		},

		async createFaq(token: string, input: CreateFaqBody) {
			const payload = parseInput(createFaqSchema, input);
			return request('/v1/faqs', faqResponseSchema, jsonInit('POST', payload, token));
		},

		async findSimilarFaq(token: string, input: { question: string; answer?: string }) {
			const payload = parseInput(faqSimilarityQuerySchema, input);
			return request(
				'/v1/faqs/similar',
				faqSimilarityResponseSchema,
				jsonInit('POST', payload, token),
			);
		},

		async updateFaq(token: string, id: FaqId, input: UpdateFaqInput) {
			const payload = parseInput(updateFaqSchema, input);
			return request(
				`/v1/faqs/${encodeURIComponent(id)}`,
				faqResponseSchema,
				jsonInit('PATCH', payload, token),
			);
		},

		async deleteFaq(token: string, id: FaqId) {
			await request(`/v1/faqs/${encodeURIComponent(id)}`, noContentSchema, {
				method: 'DELETE',
				headers: authHeaders(token),
			});
		},

		async listCustomers(token: string, query?: Partial<PaginationQuery>) {
			const { page, pageSize } = parseInput(paginationQuerySchema, query ?? {});
			const search = new URLSearchParams({
				page: String(page),
				pageSize: String(pageSize),
			});
			return request(`/v1/customers?${search.toString()}`, customerListResponseSchema, {
				method: 'GET',
				headers: authHeaders(token),
			});
		},

		async createCustomer(token: string, input: CreateCustomerBody) {
			const payload = parseInput(createCustomerSchema, input);
			return request('/v1/customers', customerResponseSchema, jsonInit('POST', payload, token));
		},

		getCustomer(token: string, id: CustomerId) {
			return request(`/v1/customers/${encodeURIComponent(id)}`, customerResponseSchema, {
				method: 'GET',
				headers: authHeaders(token),
			});
		},

		async updateCustomer(token: string, id: CustomerId, input: UpdateCustomerInput) {
			const payload = parseInput(updateCustomerSchema, input);
			return request(
				`/v1/customers/${encodeURIComponent(id)}`,
				customerResponseSchema,
				jsonInit('PATCH', payload, token),
			);
		},

		async deleteCustomer(token: string, id: CustomerId) {
			await request(`/v1/customers/${encodeURIComponent(id)}`, noContentSchema, {
				method: 'DELETE',
				headers: authHeaders(token),
			});
		},

		async listCompanies(token: string, query?: CompanyListQuery) {
			const { page, pageSize } = parseInput(paginationQuerySchema, {
				page: query?.page,
				pageSize: query?.pageSize,
			});
			const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
			const term = query?.search?.trim();
			if (term) {
				params.set('search', term);
			}
			return request(`/v1/admin/companies?${params.toString()}`, accountListResponseSchema, {
				method: 'GET',
				headers: authHeaders(token),
			});
		},

		switchCompany(token: string, accountId: AccountId) {
			return request(
				`/v1/admin/companies/${encodeURIComponent(accountId)}/switch`,
				authResponseSchema,
				{ method: 'POST', headers: authHeaders(token) },
			);
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

export type { Account, Customer, Faq, Item, PaginationMeta, Role, User };

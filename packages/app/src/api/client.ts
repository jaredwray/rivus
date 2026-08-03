import {
	type AcceptInviteInput,
	type Account,
	type AccountId,
	acceptInviteSchema,
	accountStatusSchema,
	agentThreadStateSchema,
	approveReplySchema,
	type ChatMessage,
	type ChatReply,
	type Conversation,
	type ConversationDetail,
	type ConversationId,
	type ConversationStatus,
	type Customer,
	type CustomerId,
	chatRequestSchema,
	conversationChannelSchema,
	conversationListQuerySchema,
	conversationStatusSchema,
	createConversationSchema,
	createCustomerSchema,
	createFaqSchema,
	createJobSchema,
	type Faq,
	type FaqId,
	faqSimilarityQuerySchema,
	faqStatusSchema,
	type InviteMemberInput,
	type Item,
	type ItemId,
	inviteMemberSchema,
	itemStatusSchema,
	type Job,
	type JobId,
	type JobListQuery,
	jobConflictQuerySchema,
	jobListQuerySchema,
	jobStatusSchema,
	type LoginInput,
	loginSchema,
	type Message,
	type MessageId,
	messageAuthorSchema,
	type Notification,
	type NotificationId,
	notificationReadStateSchema,
	notificationTypeSchema,
	type PaginationMeta,
	type PaginationQuery,
	type ProvisionedChannel,
	paginationQuerySchema,
	type Role,
	roleSchema,
	type SendMessageInput,
	searchQuerySchema,
	seedAccountSchema,
	sendMessageSchema,
	signupSchema,
	type UpdateAccountInput,
	type UpdateConversationInput,
	type UpdateCustomerInput,
	type UpdateFaqInput,
	type UpdateJobInput,
	type UpdateProfileInput,
	type User,
	type UserId,
	updateAccountSchema,
	updateConversationSchema,
	updateCustomerSchema,
	updateFaqSchema,
	updateJobSchema,
	updateProfileSchema,
	type VerifyCodeInput,
	type VerifyEmailChangeInput,
	verifyCodeSchema,
	verifyEmailChangeSchema,
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

/**
 * createJob accepts the schema's *input*: only `title` and `startAt` are
 * required; every other field (assignee, customer, duration, status, …) has a
 * schema default the API fills, so callers may omit them.
 */
export type CreateJobBody = z.input<typeof createJobSchema>;

// `@rivus/core` brands its ids so a user id can't be passed where an item id is
// expected. The wire format is a plain string; these helpers validate as strings
// while preserving the brand in the inferred type.
const itemId = () => z.string().min(1) as unknown as z.ZodType<ItemId>;
const faqId = () => z.string().min(1) as unknown as z.ZodType<FaqId>;
const customerId = () => z.string().min(1) as unknown as z.ZodType<CustomerId>;
const jobId = () => z.string().min(1) as unknown as z.ZodType<JobId>;
const accountId = () => z.string().min(1) as unknown as z.ZodType<AccountId>;
const userId = () => z.string().min(1) as unknown as z.ZodType<UserId>;
const notificationId = () => z.string().min(1) as unknown as z.ZodType<NotificationId>;
const conversationId = () => z.string().min(1) as unknown as z.ZodType<ConversationId>;
const messageId = () => z.string().min(1) as unknown as z.ZodType<MessageId>;

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
 * Thrown when a request never reaches the server — the device is offline, DNS
 * fails, the connection is refused, or CORS blocks it. The platform's raw
 * message for these is opaque ("Load failed" on WebKit, "Failed to fetch" on
 * Chromium, "Network request failed" on React Native); this carries one clear,
 * actionable line instead, and a `status` of 0 so callers can tell it apart
 * from an HTTP error response. Extends {@link ApiError} so existing handlers
 * that surface `error.message` keep working.
 */
export class NetworkError extends ApiError {
	constructor(cause?: unknown) {
		super("Couldn't reach Rivus. Check your internet connection and try again.", 0, cause);
		this.name = 'NetworkError';
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
	id: userId(),
	email: z.string(),
	name: z.string(),
	phone: z.string(),
	pendingEmail: z.string(),
	avatarUrl: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
}) satisfies z.ZodType<User>;
/** The signed-in user as returned by the API (id is a plain string on the wire). */
export type ProfileUser = z.infer<typeof userResponseSchema>;

// The API omits `providerRef` (a server-only handle) from channel configs, so it
// defaults to '' here — keeping the parsed shape assignable to the full `Account`
// type. Channels default as a whole so a session from an older API still parses.
const channelConfigResponseSchema = z.object({
	enabled: z.boolean(),
	address: z.string(),
	providerRef: z.string().default(''),
});

/**
 * Twilio's shared WhatsApp sandbox number — what the account's WhatsApp address
 * equals while the dev-only sandbox switch ({@link ApiClient.sandboxWhatsapp})
 * is attached. Mirrors the API's constant of the same name.
 */
export const TWILIO_WHATSAPP_SANDBOX_NUMBER = '+14155238886';

const accountResponseSchema = z.object({
	id: accountId(),
	name: z.string(),
	agentName: z.string().default('Rivus'),
	slug: z.string(),
	phone: z.string(),
	address: z.string(),
	website: z.string(),
	timezone: z.string(),
	channels: z
		.object({
			whatsapp: channelConfigResponseSchema,
			sms: channelConfigResponseSchema,
			voice: channelConfigResponseSchema,
		})
		.default({
			whatsapp: { enabled: false, address: '', providerRef: '' },
			sms: { enabled: false, address: '', providerRef: '' },
			voice: { enabled: false, address: '', providerRef: '' },
		}),
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
	// Domain of the account's inbound agent address; the UI shows the full
	// address as `${agentEmailLocalPart(account.slug, account.id)}@${agentEmailDomain}`
	// (see Settings).
	agentEmailDomain: z.string(),
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
	agentEmailDomain: z.string(),
});
export type Session = z.infer<typeof sessionResponseSchema>;

const signedOutResponseSchema = z.object({
	status: z.literal('signed_out'),
});

const memberResponseSchema = z.object({
	userId: userId(),
	email: z.string(),
	name: z.string(),
	avatarUrl: z.string(),
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

// Rivus's single chat reply (see {@link RivusApiClient.chat}).
const chatReplyResponseSchema = z.object({ reply: z.string() }) satisfies z.ZodType<ChatReply>;

const customerResponseSchema = z.object({
	id: customerId(),
	accountId: accountId(),
	name: z.string(),
	email: z.string(),
	phone: z.string(),
	address: z.string(),
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

const jobResponseSchema = z.object({
	id: jobId(),
	accountId: accountId(),
	customerId: z.string(),
	assignedUserId: z.string(),
	title: z.string(),
	status: jobStatusSchema,
	startAt: z.string(),
	durationMinutes: z.number().int(),
	address: z.string(),
	notes: z.string(),
	estimatedValue: z.number().int(),
	createdAt: z.string(),
	updatedAt: z.string(),
}) satisfies z.ZodType<Job>;

const jobListResponseSchema = z.object({
	data: z.array(jobResponseSchema),
	meta: paginationMetaSchema,
});

export interface JobListResponse {
	data: Job[];
	meta: PaginationMeta;
}

const jobConflictsResponseSchema = z.object({
	conflicts: z.array(jobResponseSchema),
});

/** Inputs for {@link RivusApiClient.getJobConflicts} (the double-booking pre-check). */
export interface JobConflictQueryInput {
	assignedUserId: string;
	startAt: string;
	durationMinutes?: number;
	/** Omit the job being edited from its own conflict check. */
	excludeJobId?: string;
}

/** Query for {@link RivusApiClient.listJobs}: pagination plus calendar filters. */
export type JobListQueryInput = Partial<JobListQuery>;

const searchResultsResponseSchema = z.object({
	customers: z.array(customerResponseSchema),
	jobs: z.array(jobResponseSchema),
});

export interface SearchResults {
	customers: Customer[];
	jobs: Job[];
}

/** Query for {@link RivusApiClient.search}: a term plus an optional per-type result cap. */
export interface SearchQueryInput {
	q: string;
	limit?: number;
}

const notificationResponseSchema = z.object({
	id: notificationId(),
	accountId: accountId(),
	userId: userId(),
	type: notificationTypeSchema,
	title: z.string(),
	body: z.string(),
	readState: notificationReadStateSchema,
	linkHref: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
}) satisfies z.ZodType<Notification>;

const notificationListResponseSchema = z.object({
	data: z.array(notificationResponseSchema),
	meta: paginationMetaSchema,
});

export interface NotificationListResponse {
	data: Notification[];
	meta: PaginationMeta;
}

/** Query for {@link RivusApiClient.listNotifications}: pagination plus an unread filter. */
export type NotificationListQuery = Partial<PaginationQuery> & { unread?: boolean };

const unreadCountResponseSchema = z.object({ unread: z.number().int() });
const markAllReadResponseSchema = z.object({ updated: z.number().int() });

const conversationResponseSchema = z.object({
	id: conversationId(),
	accountId: accountId(),
	customerId: z.string(),
	contactName: z.string(),
	contactPhone: z.string(),
	channel: conversationChannelSchema,
	status: conversationStatusSchema,
	snippet: z.string(),
	tags: z.array(z.string()),
	lastInvoice: z.string(),
	pendingReply: z.string(),
	flagReason: z.string(),
	lastMessageAt: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
}) satisfies z.ZodType<Conversation>;

const conversationListResponseSchema = z.object({
	data: z.array(conversationResponseSchema),
	meta: paginationMetaSchema,
});

export interface ConversationListResponse {
	data: Conversation[];
	meta: PaginationMeta;
}

const messageResponseSchema = z.object({
	id: messageId(),
	conversationId: conversationId(),
	author: messageAuthorSchema,
	body: z.string(),
	createdAt: z.string(),
}) satisfies z.ZodType<Message>;

const conversationDetailResponseSchema = z.object({
	conversation: conversationResponseSchema,
	messages: z.array(messageResponseSchema),
}) satisfies z.ZodType<ConversationDetail>;

const needsAttentionCountResponseSchema = z.object({ count: z.number().int() });

/** Query for {@link RivusApiClient.listConversations}: pagination plus a status filter. */
export type ConversationListQueryInput = Partial<PaginationQuery> & { status?: ConversationStatus };

/** createConversation accepts the schema's *input* (every field but name/channel optional). */
export type CreateConversationBody = z.input<typeof createConversationSchema>;

/** approveReply accepts the schema's *input* (`body` optional — omit to send the held draft). */
export type ApproveReplyBody = z.input<typeof approveReplySchema>;

/** seedAccount accepts the schema's *input* — every count, `ai`, and `seed` optional. */
export type SeedAccountBody = z.input<typeof seedAccountSchema>;

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

// Tally returned by the development-only account seeder (mirrors the API's
// `seedSummaryResponseSchema`).
const seedSummaryResponseSchema = z.object({
	customers: z.number().int(),
	faqs: z.number().int(),
	faqsSkipped: z.number().int(),
	appointments: z.number().int(),
	notifications: z.number().int(),
	conversations: z.number().int(),
	members: z.number().int(),
	generation: z.enum(['ai', 'deterministic']),
});
export type SeedSummary = z.infer<typeof seedSummaryResponseSchema>;

// Result of the development-only release-and-reset flow (mirrors the API's
// `releaseNumberResponseSchema`): numbers Twilio confirmed released, numbers
// forgotten without confirmation (unknown to the deployment's Twilio account),
// then the reset account.
const releaseNumberResponseSchema = z.object({
	released: z.array(z.string()),
	forgotten: z.array(z.string()),
	account: accountResponseSchema,
});
export type ReleaseNumberResult = z.infer<typeof releaseNumberResponseSchema>;

// --- Agent tester (development + Rivus staff only) -----------------------------

/** Base path of the Agent Tester routes; every tester call hangs off it. */
const TESTER_BASE = '/v1/admin/agent-tester';
/** The sessions themselves — everything but the account-wide voice probe. */
const TESTER_ROOT = `${TESTER_BASE}/sessions`;

/**
 * The channels the Agent Tester can impersonate a customer on — every channel
 * the inbox knows. `phone` is a simulated voice call: you type what the caller
 * says, and the reply that comes back is the line Rivus would speak.
 */
const testerChannelSchema = z.enum(['email', 'sms', 'whatsapp', 'phone'], {
	error: 'Choose a valid channel.',
});
/** A channel a tester session can run on (see {@link RivusApiClient.createTesterSession}). */
export type TesterChannel = z.infer<typeof testerChannelSchema>;

/**
 * One impersonated conversation with the customer-facing agent: who staff are
 * pretending to be, on which channel, and where the agent's scheduling state
 * machine stands after the last turn.
 */
const testerSessionResponseSchema = z.object({
	id: z.string(),
	channel: testerChannelSchema,
	contactAddress: z.string(),
	contactName: z.string(),
	/** The matched CRM customer, or '' when the contact isn't one (the signup flow). */
	customerId: z.string(),
	state: agentThreadStateSchema,
	/** The inbox conversation carrying this session's transcript. */
	conversationId: z.string(),
	snippet: z.string(),
	/** Subject of the email thread; empty on channels without subjects. */
	subject: z.string(),
	/** The job the agent booked on this session, or '' until it books one. */
	bookedJobId: z.string(),
	lastMessageAt: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type TesterSession = z.infer<typeof testerSessionResponseSchema>;

const testerSessionListResponseSchema = z.object({
	data: z.array(testerSessionResponseSchema),
});
export interface TesterSessionListResponse {
	data: TesterSession[];
}

/** A tester session with its full transcript (the same messages the inbox shows). */
export interface TesterSessionDetail {
	session: TesterSession;
	messages: Message[];
}

const testerSessionDetailResponseSchema = z.object({
	session: testerSessionResponseSchema,
	messages: z.array(messageResponseSchema),
}) satisfies z.ZodType<TesterSessionDetail>;

/**
 * What the agent *would* have delivered on the channel for this turn — nothing
 * is actually sent. `subject`/`html` are email-only.
 */
export interface TesterDelivery {
	text: string;
	subject?: string;
	html?: string;
}

/** The result of one impersonated turn (see {@link RivusApiClient.sendTesterMessage}). */
export interface TesterTurn {
	/** The engine's decision for this turn, e.g. `offer_slots`. */
	outcome: string;
	delivery: TesterDelivery;
	/**
	 * Voice only: where the turn left the call — still listening for the caller's
	 * next words, or hung up after speaking. Absent on the messaging channels.
	 */
	call?: 'listen' | 'ended';
	session: TesterSession;
	messages: Message[];
}

const testerTurnResponseSchema = z.object({
	outcome: z.string(),
	delivery: z.object({
		text: z.string(),
		subject: z.string().optional(),
		html: z.string().optional(),
	}),
	call: z.enum(['listen', 'ended']).optional(),
	session: testerSessionResponseSchema,
	messages: z.array(messageResponseSchema),
}) satisfies z.ZodType<TesterTurn>;

/**
 * Open a tester session as either a CRM customer (`customerId`) or an arbitrary
 * contact (`contactAddress`) — exactly one, which the API enforces. Blank fields
 * are dropped client-side so an empty string never reads as "both were given".
 */
const createTesterSessionSchema = z.object({
	channel: testerChannelSchema,
	customerId: z.string().trim().default(''),
	contactAddress: z.string().trim().default(''),
	contactName: z.string().trim().default(''),
	subject: z.string().trim().default(''),
});
/** Input for {@link RivusApiClient.createTesterSession}. */
export type CreateTesterSessionInput = z.input<typeof createTesterSessionSchema>;

/** The impersonated customer's message for one turn. */
const testerMessageSchema = z.object({
	text: z
		.string({ error: 'Message is required.' })
		.trim()
		.min(1, { error: 'Message is required.' })
		.max(4000, { error: 'Message must be 4000 characters or fewer.' }),
});
/** Input for {@link RivusApiClient.sendTesterMessage}. */
export type SendTesterMessageInput = z.infer<typeof testerMessageSchema>;

/**
 * Whether this deployment can hold a *spoken* tester call — synthesizing the
 * agent's line and transcribing the caller's. False on a deployment with no
 * speech provider, where the tester works exactly as it always has.
 */
const testerVoiceResponseSchema = z.object({ enabled: z.boolean() });
export type TesterVoice = z.infer<typeof testerVoiceResponseSchema>;

/** One synthesized line: base64 audio plus the media type needed to play it. */
const testerSpeechResponseSchema = z.object({
	audio: z.string(),
	mediaType: z.string(),
});
export type TesterSpeech = z.infer<typeof testerSpeechResponseSchema>;

/** What the caller was heard to say; empty when the recording held no speech. */
const testerTranscriptionResponseSchema = z.object({ text: z.string() });
export type TesterTranscription = z.infer<typeof testerTranscriptionResponseSchema>;

/** The line to say out loud — normally the `delivery.text` of a turn just run. */
const testerSpeechSchema = z.object({
	text: z
		.string({ error: 'Text is required.' })
		.trim()
		.min(1, { error: 'Text is required.' })
		.max(4000, { error: 'Text must be 4000 characters or fewer.' }),
});
/** Input for {@link RivusApiClient.speakTesterReply}. */
export type SpeakTesterReplyInput = z.infer<typeof testerSpeechSchema>;

/** One recorded utterance, base64-encoded so it rides inside the JSON body. */
const testerTranscribeSchema = z.object({
	audio: z.string({ error: 'Audio is required.' }).min(1, { error: 'Audio is required.' }),
});
/** Input for {@link RivusApiClient.transcribeTesterAudio}. */
export type TranscribeTesterAudioInput = z.infer<typeof testerTranscribeSchema>;

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
	/**
	 * Update your own profile (name, phone, email). Changing the email doesn't take
	 * effect immediately: the API stages it on `pendingEmail` and emails a one-time
	 * code, which {@link RivusApiClient.verifyEmailChange} confirms.
	 */
	updateProfile(token: string, input: UpdateProfileInput): Promise<ProfileUser>;
	/**
	 * Confirm a pending email change with the code sent to the new address. Returns
	 * a fresh session (the new token/cookie carry the updated email).
	 */
	verifyEmailChange(token: string, input: VerifyEmailChangeInput): Promise<AuthResponse>;
	listMembers(token: string): Promise<MemberList>;
	inviteMember(token: string, input: InviteMemberInput): Promise<Invite>;
	/** Update the account's business settings (owner only). */
	updateAccount(token: string, input: UpdateAccountInput): Promise<Account>;
	/** Cancel (soft-delete) the account (owner only). */
	cancelAccount(token: string): Promise<Account>;
	/** Enable a messaging channel — the API provisions a number (owner only). */
	enableChannel(token: string, channel: ProvisionedChannel): Promise<Account>;
	/** Disable a messaging channel; its number is retained (owner only). */
	disableChannel(token: string, channel: ProvisionedChannel): Promise<Account>;
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
	/**
	 * Chat with Rivus: send the conversation so far, get its single reply back.
	 * Auth is optional — signed-in callers (bearer on native, session cookie on
	 * web) get answers from their company and knowledge base, anonymous callers
	 * get the greeting and a sign-in nudge. The token trails (and is optional)
	 * because chat is the one call that works signed out.
	 */
	chat(messages: ChatMessage[], token?: string): Promise<ChatReply>;
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
	/** List the account's scheduled jobs, optionally filtered to a calendar window. */
	listJobs(token: string, query?: JobListQueryInput): Promise<JobListResponse>;
	/** Schedule a job for the account. */
	createJob(token: string, input: CreateJobBody): Promise<Job>;
	/** Fetch one of the account's jobs. */
	getJob(token: string, id: JobId): Promise<Job>;
	/** Update or reschedule one of the account's jobs. */
	updateJob(token: string, id: JobId, input: UpdateJobInput): Promise<Job>;
	/** Delete one of the account's jobs. */
	deleteJob(token: string, id: JobId): Promise<void>;
	/**
	 * Check whether a proposed booking would double-book the assignee. Returns the
	 * overlapping jobs (empty when the slot is free).
	 */
	getJobConflicts(token: string, query: JobConflictQueryInput): Promise<{ conflicts: Job[] }>;
	/**
	 * Global search across the account's customers and jobs (the dashboard's
	 * top-bar search box). Returns the matches grouped by type.
	 */
	search(token: string, query: SearchQueryInput): Promise<SearchResults>;
	/** List your notifications, optionally narrowed to unread only. */
	listNotifications(
		token: string,
		query?: NotificationListQuery,
	): Promise<NotificationListResponse>;
	/** Count your unread notifications (for the bell badge). */
	unreadNotificationCount(token: string): Promise<number>;
	/** Mark one notification read; returns the updated notification. */
	markNotificationRead(token: string, id: NotificationId): Promise<Notification>;
	/** Mark every notification read; returns how many were changed. */
	markAllNotificationsRead(token: string): Promise<number>;
	/** Dismiss (delete) one of your notifications. */
	dismissNotification(token: string, id: NotificationId): Promise<void>;
	/** List the account's conversations (the inbox), optionally filtered by status. */
	listConversations(
		token: string,
		query?: ConversationListQueryInput,
	): Promise<ConversationListResponse>;
	/** Open a conversation. */
	createConversation(token: string, input: CreateConversationBody): Promise<Conversation>;
	/** Fetch one conversation with its full message transcript. */
	getConversation(token: string, id: ConversationId): Promise<ConversationDetail>;
	/** Update a conversation's metadata (tags, status, contact, …). */
	updateConversation(
		token: string,
		id: ConversationId,
		input: UpdateConversationInput,
	): Promise<Conversation>;
	/** Delete a conversation. */
	deleteConversation(token: string, id: ConversationId): Promise<void>;
	/** Count conversations that need a human (for the Inbox sidebar badge). */
	needsAttentionCount(token: string): Promise<number>;
	/** Send a reply to a conversation as a team member. */
	sendMessage(
		token: string,
		id: ConversationId,
		input: SendMessageInput,
	): Promise<ConversationDetail>;
	/** Ask Rivus to draft (and send, or hold for review) a reply from the knowledge base. */
	replyWithRivus(token: string, id: ConversationId): Promise<ConversationDetail>;
	/** Approve and send Rivus's held draft, optionally replacing it with an edited body. */
	approveReply(
		token: string,
		id: ConversationId,
		input?: ApproveReplyBody,
	): Promise<ConversationDetail>;
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
	/**
	 * Seed the current account with demo data (customers, FAQs, appointments,
	 * notifications, conversations) and return a tally of what was created.
	 *
	 * Development + Rivus-staff only: the API registers this route solely when its
	 * `NODE_ENV` is `development`, so it 404s in any deployed environment and 403s
	 * for non-staff callers. The app gates the Settings affordance the same way.
	 */
	seedAccount(token: string, input?: SeedAccountBody): Promise<SeedSummary>;
	/**
	 * Point the current account's WhatsApp channel at Twilio's shared sandbox
	 * number (or detach it), so sandbox conversations reach the scheduling agent
	 * — the zero-compliance way to test WhatsApp end-to-end in development.
	 *
	 * Development + Rivus-staff only, exactly like {@link seedAccount}: the route
	 * 404s in deployed environments and 403s for non-staff callers. The API
	 * refuses to replace (or clear) a real provisioned number.
	 */
	sandboxWhatsapp(token: string, mode?: 'attach' | 'detach'): Promise<Account>;
	/**
	 * Release every Twilio-rented number the current account holds and reset its
	 * WhatsApp, SMS, and voice channels to disabled with no number — the "start
	 * over" for a development number stuck in a broken state. Resolves with the
	 * released (and forgotten) numbers and the reset account. Each rental's
	 * channels reset as its release is confirmed, so a mid-batch provider
	 * refusal rejects (502) with already-released numbers cleared and the
	 * failing one still on the account; a number the deployment can't release
	 * at all (another provider's rental, or no Twilio credentials) rejects
	 * (409). A number Twilio doesn't know under this deployment's account
	 * (already console-released — or another Twilio account's, still billing)
	 * also rejects (409) unless `clearUnknown` explicitly forgets it.
	 *
	 * Development + Rivus-staff only, exactly like {@link seedAccount}: the route
	 * 404s in deployed environments and 403s for non-staff callers.
	 */
	releaseNumber(token: string, options?: { clearUnknown?: boolean }): Promise<ReleaseNumberResult>;
	/**
	 * List the Agent Tester's impersonated sessions, newest activity first.
	 *
	 * Development + Rivus-staff only, exactly like {@link seedAccount}: the routes
	 * exist solely on a development deployment (404 elsewhere) and 403 for
	 * non-staff callers. The Agent Tester screen surfaces both as an explanation
	 * rather than an error.
	 */
	listTesterSessions(token: string): Promise<TesterSessionListResponse>;
	/**
	 * Open a tester session against a customer (`customerId`) or an arbitrary
	 * contact address (`contactAddress`) — exactly one of the two. Rejects with a
	 * 409 when a session already exists for that contact on that channel.
	 */
	createTesterSession(token: string, input: CreateTesterSessionInput): Promise<TesterSession>;
	/** Fetch one tester session with its full transcript. */
	getTesterSession(token: string, id: string): Promise<TesterSessionDetail>;
	/**
	 * Send one message *as the impersonated customer*. The API runs the real agent
	 * pipeline and returns the reply it would have delivered (nothing is sent),
	 * the turn's outcome, and the updated session + transcript.
	 */
	sendTesterMessage(token: string, id: string, input: SendTesterMessageInput): Promise<TesterTurn>;
	/** Delete a tester session, resetting the agent state for that contact. */
	deleteTesterSession(token: string, id: string): Promise<void>;
	/**
	 * Whether a tester phone session can be *held* rather than typed — the API
	 * has a speech provider, so the caller's side can be spoken into a microphone
	 * and the agent's replied out loud in a real voice.
	 *
	 * Development + Rivus-staff only like the rest of the tester. When it answers
	 * `false` there is no microphone to offer and reading a reply aloud falls back
	 * to the browser's own speech synthesis.
	 */
	getTesterVoice(token: string): Promise<TesterVoice>;
	/**
	 * Synthesize a line of the agent's reply — normally the `delivery.text` a turn
	 * just returned, which on a call is the whole spoken line. Nothing about the
	 * session changes. Rejects with a 503 when the deployment has no speech
	 * provider (check {@link getTesterVoice} first).
	 */
	speakTesterReply(token: string, id: string, input: SpeakTesterReplyInput): Promise<TesterSpeech>;
	/**
	 * Transcribe one recorded utterance (base64 audio, in whatever container the
	 * browser recorded). The text comes back to be sent through
	 * {@link sendTesterMessage} like any typed turn; an empty `text` means the
	 * recording held no speech, which is a normal answer rather than a failure.
	 * Rejects with a 503 when the deployment has no speech provider.
	 */
	transcribeTesterAudio(
		token: string,
		id: string,
		input: TranscribeTesterAudioInput,
	): Promise<TesterTranscription>;
}

/** Strip a single trailing slash so `${base}${path}` never doubles up. */
function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, '');
}

/**
 * Re-throw a transport-layer failure as a friendly {@link NetworkError}, except
 * for an `AbortError` — a deliberate client-side cancellation, which is
 * propagated unchanged so callers can tell a cancel from an unreachable server.
 */
function asTransportError(cause: unknown): never {
	if (cause instanceof Error && cause.name === 'AbortError') {
		throw cause;
	}
	throw new NetworkError(cause);
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
		let response: Response;
		try {
			response = await fetchImpl(`${root}${path}`, credentials ? { ...init, credentials } : init);
		} catch (cause) {
			// `fetch` rejects (typically with a TypeError) only when the request
			// never got a response — offline, DNS/connection failure, CORS. Turn
			// that into one clear, actionable message; HTTP error *responses* are
			// handled below via `response.ok`.
			asTransportError(cause);
		}
		// The body read can also fail mid-stream (e.g. a mobile connection drops
		// after headers arrive), so it gets the same treatment as the fetch above.
		let raw: string;
		try {
			raw = await response.text();
		} catch (cause) {
			asTransportError(cause);
		}
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

		async updateProfile(token: string, input: UpdateProfileInput) {
			const payload = parseInput(updateProfileSchema, input);
			return request('/v1/auth/me', userResponseSchema, jsonInit('PATCH', payload, token));
		},

		async verifyEmailChange(token: string, input: VerifyEmailChangeInput) {
			const payload = parseInput(verifyEmailChangeSchema, input);
			return request(
				'/v1/auth/me/email/verify',
				authResponseSchema,
				jsonInit('POST', payload, token),
			);
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

		/** Enable a messaging channel — the API provisions a number (owner only). */
		enableChannel(token: string, channel: ProvisionedChannel) {
			return request(`/v1/account/channels/${channel}/enable`, accountResponseSchema, {
				method: 'POST',
				headers: authHeaders(token),
			});
		},

		/** Disable a messaging channel; its number is retained for re-enabling (owner only). */
		disableChannel(token: string, channel: ProvisionedChannel) {
			return request(`/v1/account/channels/${channel}/disable`, accountResponseSchema, {
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

		async chat(messages: ChatMessage[], token?: string) {
			const payload = parseInput(chatRequestSchema, { messages });
			return request('/v1/chat', chatReplyResponseSchema, jsonInit('POST', payload, token));
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

		async listJobs(token: string, query?: JobListQueryInput) {
			const parsed = parseInput(jobListQuerySchema, query ?? {});
			const params = new URLSearchParams({
				page: String(parsed.page),
				pageSize: String(parsed.pageSize),
			});
			// Append only the filters that were actually supplied, so an unfiltered
			// call stays `?page=&pageSize=` and the API returns the whole list.
			if (parsed.from) {
				params.set('from', parsed.from);
			}
			if (parsed.to) {
				params.set('to', parsed.to);
			}
			if (parsed.assignedUserId) {
				params.set('assignedUserId', parsed.assignedUserId);
			}
			if (parsed.status) {
				params.set('status', parsed.status);
			}
			if (parsed.customerId) {
				params.set('customerId', parsed.customerId);
			}
			return request(`/v1/jobs?${params.toString()}`, jobListResponseSchema, {
				method: 'GET',
				headers: authHeaders(token),
			});
		},

		async createJob(token: string, input: CreateJobBody) {
			const payload = parseInput(createJobSchema, input);
			return request('/v1/jobs', jobResponseSchema, jsonInit('POST', payload, token));
		},

		getJob(token: string, id: JobId) {
			return request(`/v1/jobs/${encodeURIComponent(id)}`, jobResponseSchema, {
				method: 'GET',
				headers: authHeaders(token),
			});
		},

		async updateJob(token: string, id: JobId, input: UpdateJobInput) {
			const payload = parseInput(updateJobSchema, input);
			return request(
				`/v1/jobs/${encodeURIComponent(id)}`,
				jobResponseSchema,
				jsonInit('PATCH', payload, token),
			);
		},

		async deleteJob(token: string, id: JobId) {
			await request(`/v1/jobs/${encodeURIComponent(id)}`, noContentSchema, {
				method: 'DELETE',
				headers: authHeaders(token),
			});
		},

		async getJobConflicts(token: string, query: JobConflictQueryInput) {
			const parsed = parseInput(jobConflictQuerySchema, query);
			const params = new URLSearchParams({
				assignedUserId: parsed.assignedUserId,
				startAt: parsed.startAt,
				durationMinutes: String(parsed.durationMinutes),
			});
			if (parsed.excludeJobId) {
				params.set('excludeJobId', parsed.excludeJobId);
			}
			return request(`/v1/jobs/conflicts?${params.toString()}`, jobConflictsResponseSchema, {
				method: 'GET',
				headers: authHeaders(token),
			});
		},

		async search(token: string, query: SearchQueryInput) {
			const parsed = parseInput(searchQuerySchema, query);
			const params = new URLSearchParams({ q: parsed.q, limit: String(parsed.limit) });
			return request(`/v1/search?${params.toString()}`, searchResultsResponseSchema, {
				method: 'GET',
				headers: authHeaders(token),
			});
		},

		async listNotifications(token: string, query?: NotificationListQuery) {
			const { page, pageSize } = parseInput(paginationQuerySchema, {
				page: query?.page,
				pageSize: query?.pageSize,
			});
			const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
			// Only ask for the unread subset when explicitly requested; otherwise the API
			// returns the full list.
			if (query?.unread) {
				params.set('unread', 'true');
			}
			return request(`/v1/notifications?${params.toString()}`, notificationListResponseSchema, {
				method: 'GET',
				headers: authHeaders(token),
			});
		},

		async unreadNotificationCount(token: string) {
			const { unread } = await request(
				'/v1/notifications/unread-count',
				unreadCountResponseSchema,
				{ method: 'GET', headers: authHeaders(token) },
			);
			return unread;
		},

		markNotificationRead(token: string, id: NotificationId) {
			return request(
				`/v1/notifications/${encodeURIComponent(id)}/read`,
				notificationResponseSchema,
				{ method: 'POST', headers: authHeaders(token) },
			);
		},

		async markAllNotificationsRead(token: string) {
			const { updated } = await request('/v1/notifications/read-all', markAllReadResponseSchema, {
				method: 'POST',
				headers: authHeaders(token),
			});
			return updated;
		},

		async dismissNotification(token: string, id: NotificationId) {
			await request(`/v1/notifications/${encodeURIComponent(id)}`, noContentSchema, {
				method: 'DELETE',
				headers: authHeaders(token),
			});
		},

		async listConversations(token: string, query?: ConversationListQueryInput) {
			const parsed = parseInput(conversationListQuerySchema, query ?? {});
			const params = new URLSearchParams({
				page: String(parsed.page),
				pageSize: String(parsed.pageSize),
			});
			// Only narrow by status when asked; otherwise the API returns the whole inbox.
			if (parsed.status) {
				params.set('status', parsed.status);
			}
			return request(`/v1/conversations?${params.toString()}`, conversationListResponseSchema, {
				method: 'GET',
				headers: authHeaders(token),
			});
		},

		async createConversation(token: string, input: CreateConversationBody) {
			const payload = parseInput(createConversationSchema, input);
			return request(
				'/v1/conversations',
				conversationResponseSchema,
				jsonInit('POST', payload, token),
			);
		},

		getConversation(token: string, id: ConversationId) {
			return request(
				`/v1/conversations/${encodeURIComponent(id)}`,
				conversationDetailResponseSchema,
				{ method: 'GET', headers: authHeaders(token) },
			);
		},

		async updateConversation(token: string, id: ConversationId, input: UpdateConversationInput) {
			const payload = parseInput(updateConversationSchema, input);
			return request(
				`/v1/conversations/${encodeURIComponent(id)}`,
				conversationResponseSchema,
				jsonInit('PATCH', payload, token),
			);
		},

		async deleteConversation(token: string, id: ConversationId) {
			await request(`/v1/conversations/${encodeURIComponent(id)}`, noContentSchema, {
				method: 'DELETE',
				headers: authHeaders(token),
			});
		},

		async needsAttentionCount(token: string) {
			const { count } = await request(
				'/v1/conversations/needs-attention-count',
				needsAttentionCountResponseSchema,
				{ method: 'GET', headers: authHeaders(token) },
			);
			return count;
		},

		async sendMessage(token: string, id: ConversationId, input: SendMessageInput) {
			const payload = parseInput(sendMessageSchema, input);
			return request(
				`/v1/conversations/${encodeURIComponent(id)}/messages`,
				conversationDetailResponseSchema,
				jsonInit('POST', payload, token),
			);
		},

		replyWithRivus(token: string, id: ConversationId) {
			return request(
				`/v1/conversations/${encodeURIComponent(id)}/reply`,
				conversationDetailResponseSchema,
				{ method: 'POST', headers: authHeaders(token) },
			);
		},

		async approveReply(token: string, id: ConversationId, input: ApproveReplyBody = {}) {
			const payload = parseInput(approveReplySchema, input);
			return request(
				`/v1/conversations/${encodeURIComponent(id)}/approve`,
				conversationDetailResponseSchema,
				jsonInit('POST', payload, token),
			);
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

		async seedAccount(token: string, input: SeedAccountBody = {}) {
			const payload = parseInput(seedAccountSchema, input);
			return request('/v1/admin/seed', seedSummaryResponseSchema, jsonInit('POST', payload, token));
		},

		sandboxWhatsapp(token: string, mode: 'attach' | 'detach' = 'attach') {
			return request(
				'/v1/admin/sandbox/whatsapp',
				accountResponseSchema,
				jsonInit('POST', { mode }, token),
			);
		},

		releaseNumber(token: string, options: { clearUnknown?: boolean } = {}) {
			return request(
				'/v1/admin/release-number',
				releaseNumberResponseSchema,
				jsonInit('POST', { clearUnknown: Boolean(options.clearUnknown) }, token),
			);
		},

		listTesterSessions(token: string) {
			return request(TESTER_ROOT, testerSessionListResponseSchema, {
				method: 'GET',
				headers: authHeaders(token),
			});
		},

		async createTesterSession(token: string, input: CreateTesterSessionInput) {
			const parsed = parseInput(createTesterSessionSchema, input);
			// Send only the fields that were actually supplied: the API requires
			// exactly one of customerId/contactAddress, and an always-present empty
			// string would read as "both were given".
			const payload: Record<string, string> = { channel: parsed.channel };
			if (parsed.customerId) {
				payload.customerId = parsed.customerId;
			}
			if (parsed.contactAddress) {
				payload.contactAddress = parsed.contactAddress;
			}
			if (parsed.contactName) {
				payload.contactName = parsed.contactName;
			}
			if (parsed.subject) {
				payload.subject = parsed.subject;
			}
			return request(TESTER_ROOT, testerSessionResponseSchema, jsonInit('POST', payload, token));
		},

		getTesterSession(token: string, id: string) {
			return request(
				`${TESTER_ROOT}/${encodeURIComponent(id)}`,
				testerSessionDetailResponseSchema,
				{
					method: 'GET',
					headers: authHeaders(token),
				},
			);
		},

		async sendTesterMessage(token: string, id: string, input: SendTesterMessageInput) {
			const payload = parseInput(testerMessageSchema, input);
			return request(
				`${TESTER_ROOT}/${encodeURIComponent(id)}/messages`,
				testerTurnResponseSchema,
				jsonInit('POST', payload, token),
			);
		},

		async deleteTesterSession(token: string, id: string) {
			await request(`${TESTER_ROOT}/${encodeURIComponent(id)}`, noContentSchema, {
				method: 'DELETE',
				headers: authHeaders(token),
			});
		},

		getTesterVoice(token: string) {
			return request(`${TESTER_BASE}/voice`, testerVoiceResponseSchema, {
				method: 'GET',
				headers: authHeaders(token),
			});
		},

		async speakTesterReply(token: string, id: string, input: SpeakTesterReplyInput) {
			const payload = parseInput(testerSpeechSchema, input);
			return request(
				`${TESTER_ROOT}/${encodeURIComponent(id)}/speech`,
				testerSpeechResponseSchema,
				jsonInit('POST', payload, token),
			);
		},

		async transcribeTesterAudio(token: string, id: string, input: TranscribeTesterAudioInput) {
			const payload = parseInput(testerTranscribeSchema, input);
			return request(
				`${TESTER_ROOT}/${encodeURIComponent(id)}/transcribe`,
				testerTranscriptionResponseSchema,
				jsonInit('POST', payload, token),
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

export type {
	Account,
	Conversation,
	ConversationDetail,
	Customer,
	Faq,
	Item,
	Job,
	Message,
	Notification,
	PaginationMeta,
	Role,
	User,
};

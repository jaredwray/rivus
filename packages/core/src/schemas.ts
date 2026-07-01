import { z } from 'zod';

/**
 * Free-text fields fail in two ways — left blank, or too long — and Zod's stock
 * copy for them is terse and leaks the raw constraint ("Too small: expected
 * string to have >=1 characters"). These helpers say, in plain language, what to
 * do instead. `requiredText` reuses one message for the missing and the blank
 * case so the caller is prompted the same way either way.
 */
function requiredText(label: string, max: number) {
	return z
		.string({ error: `${label} is required.` })
		.trim()
		.min(1, { error: `${label} is required.` })
		.max(max, { error: `${label} must be ${max} characters or fewer.` });
}

/** An optional, trimmed free-text field, capped so it can't overflow storage. */
function optionalText(label: string, max: number) {
	return z
		.string()
		.trim()
		.max(max, { error: `${label} must be ${max} characters or fewer.` });
}

/**
 * Trim + lowercase before validating so `  Foo@Bar.com ` is accepted. Built from
 * a plain `z.string()` (not `z.preprocess`) so generated OpenAPI/JSON Schema
 * still marks the field as required.
 */
export const emailSchema = z
	.string({ error: 'Email address is required.' })
	.trim()
	.toLowerCase()
	.pipe(
		z
			.email({ error: 'Enter a valid email address.' })
			.max(254, { error: 'That email address is too long.' }),
	);

export const nameSchema = requiredText('Name', 120);

/**
 * A 6-digit numeric one-time code emailed for passwordless sign-in. Trimmed so
 * pasted codes with stray whitespace still validate.
 */
export const verificationCodeSchema = z
	.string()
	.trim()
	.regex(/^\d{6}$/, { error: 'Enter the 6-digit code we emailed you.' });

export const loginSchema = z.object({
	email: emailSchema,
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Verify a one-time code (login or signup) and exchange it for a session. */
export const verifyCodeSchema = z.object({
	email: emailSchema,
	code: verificationCodeSchema,
});
export type VerifyCodeInput = z.infer<typeof verifyCodeSchema>;

// --- Accounts, roles & business information -----------------------------------

// `Role` itself is the source-of-truth union in `types.ts` (mirrors the
// `ItemStatus`/`itemStatusSchema` split); here we only need the runtime schema.
/** Every role a member can hold. */
export const roleSchema = z.enum(['owner', 'manager', 'member'], {
	error: 'Choose a valid role.',
});

/** Lifecycle state of an account (`canceled` is a soft delete). */
export const accountStatusSchema = z.enum(['active', 'canceled'], {
	error: 'Status must be either active or canceled.',
});

export const businessNameSchema = requiredText('Business name', 160);
export const phoneSchema = optionalText('Phone number', 40);
export const addressSchema = optionalText('Address', 300);
export const timezoneSchema = optionalText('Time zone', 64);
// `http://` / `https://` specifically, vs. *any* `scheme://`. A value that
// already carries a non-http scheme (e.g. `ftp://`) must not be silently
// rewritten into `https://ftp://…`, so we detect schemes before normalizing.
const HTTP_SCHEME = /^https?:\/\//i;
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
// A dotted, multi-label host (so a bare word like `acme` is rejected even
// though URL parsing would accept `https://acme`), allowing an optional
// port/path/query/fragment after it.
const DOMAINISH = /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}([:/?#].*)?$/i;

/**
 * A website URL, or an empty string when none is provided.
 *
 * The scheme is optional: a bare domain like `example.com` is accepted and
 * normalized to `https://example.com`, so people don't have to type the
 * protocol. An explicit `http://`/`https://` is kept as-is; any other scheme,
 * or a bare value that isn't a real domain (`acme`, `not a url`), is rejected
 * rather than silently rewritten into something that points elsewhere. The
 * normalized value is what's validated and stored.
 */
export const websiteSchema = z
	.string()
	.trim()
	.max(2048, { error: 'That website URL is too long.' })
	.transform((value) => {
		// Only assume `https://` for a scheme-less value that already looks like a
		// domain. Anything else is passed through untouched for the refine to judge.
		if (value === '' || ANY_SCHEME.test(value)) return value;
		return DOMAINISH.test(value) ? `https://${value}` : value;
	})
	.refine(
		(value) =>
			value === '' ||
			(HTTP_SCHEME.test(value) &&
				z.url().safeParse(value).success &&
				DOMAINISH.test(value.replace(HTTP_SCHEME, ''))),
		{ error: 'Enter a valid website, like example.com.' },
	);

// `http(s)://` for a hosted image, or a `data:image/...;base64,` URI for a photo
// uploaded from the profile screen (which re-encodes the picked image to one of
// these before saving). `z.url()` alone would also accept `javascript:`, `ftp:`,
// or a `data:` URI of any other MIME type, so the scheme is checked explicitly.
const AVATAR_HTTP_URL = /^https?:\/\//i;
const AVATAR_DATA_URL = /^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/]+=*$/i;
// Comfortably covers a compressed square avatar photo as base64 (~675KB decoded)
// while staying under Fastify's default 1MiB (1,048,576-byte) request body limit
// — a value any closer to that limit risks the request being rejected at the
// body-parsing layer (a raw 413) before this schema ever gets to say why.
const MAX_AVATAR_LENGTH = 900_000;

/**
 * A custom profile-image URL — a hosted `https://…` link, or a photo uploaded
 * from the app encoded as a `data:image/...;base64,` URI — or an empty string to
 * fall back to the user's Gravatar.
 */
export const avatarUrlSchema = z
	.string()
	.trim()
	.max(MAX_AVATAR_LENGTH, { error: 'That image is too large.' })
	.refine(
		(value) =>
			value === '' ||
			(AVATAR_HTTP_URL.test(value) && z.url().safeParse(value).success) ||
			AVATAR_DATA_URL.test(value),
		{ error: 'Enter a valid image URL, like https://example.com/photo.jpg.' },
	);

/** The "standard business information" collected when an account is created. */
export const accountBusinessSchema = z.object({
	businessName: businessNameSchema,
	phone: phoneSchema.default(''),
	address: addressSchema.default(''),
	website: websiteSchema.default(''),
	timezone: timezoneSchema.default('UTC'),
});
export type AccountBusinessInput = z.infer<typeof accountBusinessSchema>;

/**
 * Sign up: capture the owner's name + email and the business details. Sign-in is
 * passwordless — submitting this emails a one-time code that `verifyCode`
 * exchanges for a session (and, on first use, creates the account).
 */
export const signupSchema = z.object({
	email: emailSchema,
	name: nameSchema,
	business: accountBusinessSchema,
});
export type SignupInput = z.infer<typeof signupSchema>;

/**
 * Invite a new member to an existing account with any role. Which roles a given
 * inviter may actually grant (an owner can grant any; a manager only `member`)
 * is enforced server-side, not by this shape.
 */
export const inviteMemberSchema = z.object({
	email: emailSchema,
	name: nameSchema,
	role: roleSchema,
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

/**
 * Accept an invitation. The invite token was emailed to the invitee, so it
 * already proves they control the address — presenting it signs them in
 * directly, no password or extra code required.
 */
export const acceptInviteSchema = z.object({
	token: z
		.string({ error: 'Enter your invite code.' })
		.min(1, { error: 'Enter your invite code.' }),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

/** Change an existing member's role (owner-only). */
export const updateMemberRoleSchema = z.object({
	role: roleSchema,
});
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

/**
 * Update an account's business information (owner-only account settings). Every
 * field is optional — like {@link updateItemSchema}, a partial update only
 * touches what the caller sends — but at least one must be present. The slug is
 * derived from the name and is not editable here.
 */
export const updateAccountSchema = z
	.object({
		businessName: businessNameSchema.optional(),
		phone: phoneSchema.optional(),
		address: addressSchema.optional(),
		website: websiteSchema.optional(),
		timezone: timezoneSchema.optional(),
	})
	.refine((value) => Object.values(value).some((field) => field !== undefined), {
		error: 'Provide at least one field to update.',
	});
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

// --- Profile (the signed-in user's own account) -------------------------------

/**
 * Update your own profile: name, sign-in email, contact phone, and profile
 * image. Every field is optional — like {@link updateAccountSchema}, a partial
 * update only touches what the caller sends — but at least one must be present.
 * Changing `email` doesn't apply immediately: the server emails a one-time code
 * to the new address and the change lands only once
 * {@link verifyEmailChangeSchema} confirms it. `avatarUrl` applies immediately;
 * an empty string clears a custom override and reverts to the Gravatar derived
 * from the email.
 */
export const updateProfileSchema = z
	.object({
		name: nameSchema.optional(),
		email: emailSchema.optional(),
		phone: phoneSchema.optional(),
		avatarUrl: avatarUrlSchema.optional(),
	})
	.refine((value) => Object.values(value).some((field) => field !== undefined), {
		error: 'Provide at least one field to update.',
	});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Confirm a pending email change with the one-time code sent to the new address.
 * The signed-in session identifies whose change it is, so only the code is needed.
 */
export const verifyEmailChangeSchema = z.object({
	code: verificationCodeSchema,
});
export type VerifyEmailChangeInput = z.infer<typeof verifyEmailChangeSchema>;
export const itemStatusSchema = z.enum(['active', 'archived'], {
	error: 'Status must be either active or archived.',
});

export const createItemSchema = z.object({
	name: nameSchema,
	description: optionalText('Description', 2000).default(''),
	status: itemStatusSchema.default('active'),
});
export type CreateItemInput = z.infer<typeof createItemSchema>;

/**
 * Every field optional, but at least one must be present. Defined without
 * `.default()`s (unlike create) so a partial update only touches the fields the
 * caller actually sent.
 */
export const updateItemSchema = z
	.object({
		name: nameSchema.optional(),
		description: optionalText('Description', 2000).optional(),
		status: itemStatusSchema.optional(),
	})
	.refine((value) => Object.values(value).some((field) => field !== undefined), {
		error: 'Provide at least one field to update.',
	});
export type UpdateItemInput = z.infer<typeof updateItemSchema>;

export const faqStatusSchema = z.enum(['published', 'draft'], {
	error: 'Status must be either published or draft.',
});

export const createFaqSchema = z.object({
	question: requiredText('Question', 300),
	answer: requiredText('Answer', 4000),
	category: optionalText('Category', 80).default(''),
	status: faqStatusSchema.default('published'),
});
export type CreateFaqInput = z.infer<typeof createFaqSchema>;

/**
 * Every field optional, but at least one must be present — mirrors
 * {@link updateItemSchema}. No `.default()`s (unlike create) so a partial update
 * only touches the fields the caller actually sent.
 */
export const updateFaqSchema = z
	.object({
		question: requiredText('Question', 300).optional(),
		answer: requiredText('Answer', 4000).optional(),
		category: optionalText('Category', 80).optional(),
		status: faqStatusSchema.optional(),
	})
	.refine((value) => Object.values(value).some((field) => field !== undefined), {
		error: 'Provide at least one field to update.',
	});
export type UpdateFaqInput = z.infer<typeof updateFaqSchema>;

/**
 * Body for the "is there already a similar FAQ?" pre-check, sent before creating
 * a new FAQ. The answer is optional — the question alone is enough to surface a
 * near-duplicate, but the answer (when present) sharpens the AI's merge.
 */
export const faqSimilarityQuerySchema = z.object({
	question: requiredText('Question', 300),
	answer: optionalText('Answer', 4000).default(''),
});
export type FaqSimilarityQueryInput = z.infer<typeof faqSimilarityQuerySchema>;

/**
 * Body for the "answer this question from the knowledge base" ask. The agent
 * forwards a visitor's free-text question (a chat turn, so it can be longer and
 * looser than an FAQ title) and the API answers it from the account's FAQs using
 * AI. The cap is generous but bounded so a runaway prompt can't be submitted.
 */
export const faqAnswerQuerySchema = z.object({
	question: requiredText('Question', 1000),
});
export type FaqAnswerQueryInput = z.infer<typeof faqAnswerQuerySchema>;

// --- Notifications ------------------------------------------------------------

// `NotificationType`/`NotificationReadState` are the source-of-truth unions in
// `types.ts` (mirroring the `ItemStatus`/`itemStatusSchema` split); here we only
// add the runtime schemas.
/** Category of a notification (see {@link NotificationType}). */
export const notificationTypeSchema = z.enum(
	['job_assigned', 'job_updated', 'job_canceled', 'invite_accepted', 'role_changed', 'system'],
	{ error: 'Choose a valid notification type.' },
);

/** Whether a notification has been read. */
export const notificationReadStateSchema = z.enum(['unread', 'read'], {
	error: 'Read state must be either unread or read.',
});

/**
 * Shape used to mint a notification. Created server-side only (by the
 * notification service reacting to domain events), so it carries no `accountId`
 * or `userId` — the account comes from the request and the recipient is chosen
 * by the service. `type` defaults to `system` for an unclassified message.
 */
export const createNotificationSchema = z.object({
	type: notificationTypeSchema.default('system'),
	title: requiredText('Title', 200),
	body: optionalText('Body', 2000).default(''),
	linkHref: optionalText('Link', 512).default(''),
});
export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;

// --- Customers ----------------------------------------------------------------

/**
 * An optional email: either an empty string or a valid address. Built like
 * {@link websiteSchema} (a plain `z.string()` refined to `'' || valid`) rather
 * than reusing the required {@link emailSchema}, so a customer with no email on
 * file is allowed while a non-empty value is still validated and normalized.
 */
export const optionalEmailSchema = z
	.string()
	.trim()
	.toLowerCase()
	.max(254, { error: 'That email address is too long.' })
	.refine((value) => value === '' || z.email().safeParse(value).success, {
		error: 'Enter a valid email address.',
	});

/** A money amount stored as a non-negative whole number of cents. */
function moneyCents(label: string) {
	return z
		.number({ error: `${label} must be a number.` })
		.int({ error: `${label} must be a whole number of cents.` })
		.min(0, { error: `${label} can't be negative.` });
}

export const createCustomerSchema = z.object({
	name: nameSchema,
	email: optionalEmailSchema.default(''),
	phone: phoneSchema.default(''),
	address: addressSchema.default(''),
	lifetimeValue: moneyCents('Lifetime value').default(0),
	balance: moneyCents('Balance').default(0),
	notes: optionalText('Notes', 2000).default(''),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

/**
 * Every field optional, but at least one must be present — mirrors
 * {@link updateItemSchema}. No `.default()`s (unlike create) so a partial update
 * only touches the fields the caller actually sent.
 */
export const updateCustomerSchema = z
	.object({
		name: nameSchema.optional(),
		email: optionalEmailSchema.optional(),
		phone: phoneSchema.optional(),
		address: addressSchema.optional(),
		lifetimeValue: moneyCents('Lifetime value').optional(),
		balance: moneyCents('Balance').optional(),
		notes: optionalText('Notes', 2000).optional(),
	})
	.refine((value) => Object.values(value).some((field) => field !== undefined), {
		error: 'Provide at least one field to update.',
	});
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

// --- Global search ------------------------------------------------------------

/**
 * Query for the dashboard's global search box (`GET /v1/search`): a required
 * free-text term plus an optional per-type result cap. `q` is trimmed and bounded
 * like every other text field; `limit` caps how many matches of *each* type
 * (customers, jobs) come back so the results dropdown stays small and fast.
 */
export const searchQuerySchema = z.object({
	q: requiredText('Search', 200),
	limit: z.coerce
		.number()
		.int({ error: 'Limit must be a whole number.' })
		.min(1, { error: 'Limit must be 1 or greater.' })
		.max(20, { error: 'Limit must be 20 or fewer.' })
		.default(8),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

/** Query string for list endpoints; coerces `?page=2&pageSize=50`. */
export const paginationQuerySchema = z.object({
	page: z.coerce.number().int().min(1, { error: 'Page must be 1 or greater.' }).default(1),
	pageSize: z.coerce
		.number()
		.int()
		.min(1, { error: 'Page size must be 1 or greater.' })
		.max(100, { error: 'Page size must be 100 or fewer.' })
		.default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

// --- Jobs (scheduling) --------------------------------------------------------

/** Every state a scheduled job can be in (see {@link JobStatus} for the order). */
export const jobStatusSchema = z.enum(
	['scheduled', 'confirmed', 'in_progress', 'completed', 'canceled'],
	{ error: 'Choose a valid job status.' },
);

/**
 * A scheduled instant: an ISO-8601 date-time in UTC (a trailing `Z`, no offset),
 * e.g. `2026-06-24T21:00:00.000Z`. Clients build it with `new Date(...).toISOString()`,
 * so storage is always a single canonical instant — chronological string sort and
 * cross-row comparisons stay correct regardless of the caller's local time zone.
 */
export const jobStartSchema = z.iso.datetime({
	error: 'Enter a valid date and time.',
});

/** Duration in whole minutes, from a single minute up to a full day. */
const durationMinutesSchema = z
	.number({ error: 'Duration must be a number of minutes.' })
	.int({ error: 'Duration must be a whole number of minutes.' })
	.min(1, { error: 'Duration must be at least 1 minute.' })
	.max(1440, { error: 'Duration must be 24 hours or less.' });

/**
 * An optional reference to another record by id (customer, team member). Empty
 * string means "none"; a non-empty value's existence is enforced server-side.
 */
const optionalRefSchema = optionalText('Reference', 128);

export const createJobSchema = z.object({
	title: requiredText('Service', 160),
	customerId: optionalRefSchema.default(''),
	assignedUserId: optionalRefSchema.default(''),
	startAt: jobStartSchema,
	durationMinutes: durationMinutesSchema.default(60),
	status: jobStatusSchema.default('scheduled'),
	address: addressSchema.default(''),
	notes: optionalText('Notes', 2000).default(''),
	estimatedValue: moneyCents('Estimated value').default(0),
});
export type CreateJobInput = z.infer<typeof createJobSchema>;

/**
 * Every field optional, but at least one must be present — mirrors
 * {@link updateItemSchema}. No `.default()`s (unlike create) so a partial update
 * only touches the fields the caller actually sent.
 */
export const updateJobSchema = z
	.object({
		title: requiredText('Service', 160).optional(),
		customerId: optionalRefSchema.optional(),
		assignedUserId: optionalRefSchema.optional(),
		startAt: jobStartSchema.optional(),
		durationMinutes: durationMinutesSchema.optional(),
		status: jobStatusSchema.optional(),
		address: addressSchema.optional(),
		notes: optionalText('Notes', 2000).optional(),
		estimatedValue: moneyCents('Estimated value').optional(),
	})
	.refine((value) => Object.values(value).some((field) => field !== undefined), {
		error: 'Provide at least one field to update.',
	});
export type UpdateJobInput = z.infer<typeof updateJobSchema>;

/**
 * Query for the job list: pagination plus optional filters. `from`/`to` bound the
 * scheduled start (`from` inclusive, `to` exclusive) so a calendar can fetch
 * exactly one visible window; the rest narrow by assignee, status, or customer.
 */
export const jobListQuerySchema = paginationQuerySchema.extend({
	from: z.iso.datetime({ error: 'Provide a valid "from" date-time.' }).optional(),
	to: z.iso.datetime({ error: 'Provide a valid "to" date-time.' }).optional(),
	assignedUserId: optionalRefSchema.optional(),
	status: jobStatusSchema.optional(),
	customerId: optionalRefSchema.optional(),
});
export type JobListQuery = z.infer<typeof jobListQuerySchema>;

/**
 * Query for the double-booking pre-check: would a job of `durationMinutes` at
 * `startAt` for `assignedUserId` overlap any of that member's existing jobs?
 * `excludeJobId` omits the job being edited from its own conflict check. Sent as a
 * query string, so `durationMinutes` is coerced from its string form.
 */
export const jobConflictQuerySchema = z.object({
	assignedUserId: requiredText('Assignee', 128),
	startAt: jobStartSchema,
	durationMinutes: z.coerce
		.number()
		.int({ error: 'Duration must be a whole number of minutes.' })
		.min(1, { error: 'Duration must be at least 1 minute.' })
		.max(1440, { error: 'Duration must be 24 hours or less.' })
		.default(60),
	excludeJobId: optionalRefSchema.optional(),
});
export type JobConflictQuery = z.infer<typeof jobConflictQuerySchema>;

// --- Conversations (inbox) ----------------------------------------------------

// `ConversationChannel`/`ConversationStatus`/`MessageAuthor` are the source-of-truth
// unions in `types.ts` (mirroring the `ItemStatus`/`itemStatusSchema` split); here
// we only add the runtime schemas.

/** The channel a conversation arrives on (see {@link ConversationChannel}). */
export const conversationChannelSchema = z.enum(['whatsapp', 'phone', 'email', 'sms'], {
	error: 'Choose a valid channel.',
});

/** Where a conversation stands with Rivus (see {@link ConversationStatus}). */
export const conversationStatusSchema = z.enum(['rivus_handling', 'needs_attention', 'resolved'], {
	error: 'Choose a valid conversation status.',
});

/** Who authored a message (see {@link MessageAuthor}). */
export const messageAuthorSchema = z.enum(['customer', 'rivus', 'agent', 'note'], {
	error: 'Choose a valid message author.',
});

/** The tags on a conversation: short free-text labels, capped so the panel stays tidy. */
const conversationTagsSchema = z
	.array(requiredText('Tag', 40))
	.max(12, { error: 'A conversation can have at most 12 tags.' });

/** Body text for a message (a chat turn or an inline note); generous but bounded. */
const messageBodySchema = requiredText('Message', 4000);

/** An invoice label for the billing card, e.g. "#1051 · $540 · Due Jun 30". */
const invoiceLabelSchema = optionalText('Invoice', 120);

export const createConversationSchema = z.object({
	contactName: requiredText('Contact name', 120),
	channel: conversationChannelSchema,
	customerId: optionalRefSchema.default(''),
	contactPhone: phoneSchema.default(''),
	status: conversationStatusSchema.default('rivus_handling'),
	tags: conversationTagsSchema.default([]),
	lastInvoice: invoiceLabelSchema.default(''),
});
export type CreateConversationInput = z.infer<typeof createConversationSchema>;

/**
 * Every field optional, but at least one must be present — mirrors
 * {@link updateItemSchema}. No `.default()`s (unlike create) so a partial update
 * only touches the fields the caller actually sent.
 */
export const updateConversationSchema = z
	.object({
		contactName: requiredText('Contact name', 120).optional(),
		channel: conversationChannelSchema.optional(),
		customerId: optionalRefSchema.optional(),
		contactPhone: phoneSchema.optional(),
		status: conversationStatusSchema.optional(),
		tags: conversationTagsSchema.optional(),
		lastInvoice: invoiceLabelSchema.optional(),
	})
	.refine((value) => Object.values(value).some((field) => field !== undefined), {
		error: 'Provide at least one field to update.',
	});
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;

/** Mint a message in a conversation. `author` defaults to a human `agent` reply. */
export const createMessageSchema = z.object({
	author: messageAuthorSchema.default('agent'),
	body: messageBodySchema,
});
export type CreateMessageInput = z.infer<typeof createMessageSchema>;

/** The composer's "send" payload — the team always sends as a human `agent`. */
export const sendMessageSchema = z.object({
	body: messageBodySchema,
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

/**
 * Approve (and send) Rivus's held draft. An empty/absent `body` sends the pending
 * draft as-is; a non-empty `body` is the human's edited version, sent instead.
 */
export const approveReplySchema = z.object({
	body: optionalText('Message', 4000).default(''),
});
export type ApproveReplyInput = z.infer<typeof approveReplySchema>;

/** List filter for the inbox: pagination plus an optional status narrowing. */
export const conversationListQuerySchema = paginationQuerySchema.extend({
	status: conversationStatusSchema.optional(),
});
export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;

// --- Account seeding (development only) ---------------------------------------

/**
 * Upper bound on any single seed count. The seeder is a development convenience
 * (see `POST /v1/admin/seed`), so a generous cap keeps a stray request from
 * ballooning the store while still allowing a healthy demo dataset.
 */
export const SEED_COUNT_MAX = 200;

/** One optional, bounded entity count for the seeder (omit ⇒ a sensible default). */
function seedCountSchema(label: string) {
	return z.coerce
		.number({ error: `${label} must be a number.` })
		.int({ error: `${label} must be a whole number.` })
		.min(0, { error: `${label} must be 0 or greater.` })
		.max(SEED_COUNT_MAX, { error: `${label} must be ${SEED_COUNT_MAX} or fewer.` })
		.optional();
}

/**
 * Request body for the development-only account seeder (`POST /v1/admin/seed`).
 *
 * Every count is optional — omit it to let the seeder pick a sensible default (a
 * curated set, or a random count in a small range). Passing `0` explicitly skips
 * that entity. `ai` opts into AI-tailored data when a provider key is configured
 * (it degrades to the built-in faker/curated generators otherwise); `seed` fixes
 * the random generator so a batch is reproducible.
 */
export const seedAccountSchema = z.object({
	customers: seedCountSchema('Customers'),
	faqs: seedCountSchema('FAQs'),
	appointments: seedCountSchema('Appointments'),
	notifications: seedCountSchema('Notifications'),
	conversations: seedCountSchema('Conversations'),
	ai: z.boolean({ error: 'AI must be true or false.' }).default(false),
	seed: z.coerce
		.number({ error: 'Seed must be a number.' })
		.int({ error: 'Seed must be a whole number.' })
		.min(0, { error: 'Seed must be 0 or greater.' })
		.optional(),
});
export type SeedAccountInput = z.infer<typeof seedAccountSchema>;

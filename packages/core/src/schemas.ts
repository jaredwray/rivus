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
/** A website URL, or an empty string when none is provided. */
export const websiteSchema = z
	.string()
	.trim()
	.max(2048, { error: 'That website URL is too long.' })
	.refine((value) => value === '' || z.url().safeParse(value).success, {
		error: 'Enter a valid website URL, like https://example.com.',
	});

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

/** The preferred channel a customer is reached on. */
export const customerChannelSchema = z.enum(['whatsapp', 'phone', 'email', 'sms'], {
	error: 'Choose a valid contact channel.',
});

/** Where a customer sits in the sales/billing lifecycle. */
export const customerStatusSchema = z.enum(['lead', 'quote', 'paid', 'due'], {
	error: 'Choose a valid status.',
});

export const createCustomerSchema = z.object({
	name: nameSchema,
	email: optionalEmailSchema.default(''),
	phone: phoneSchema.default(''),
	address: addressSchema.default(''),
	channel: customerChannelSchema.default('phone'),
	status: customerStatusSchema.default('lead'),
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
		channel: customerChannelSchema.optional(),
		status: customerStatusSchema.optional(),
		lifetimeValue: moneyCents('Lifetime value').optional(),
		balance: moneyCents('Balance').optional(),
		notes: optionalText('Notes', 2000).optional(),
	})
	.refine((value) => Object.values(value).some((field) => field !== undefined), {
		error: 'Provide at least one field to update.',
	});
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

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

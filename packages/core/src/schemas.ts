import { z } from 'zod';

/** Trim + lowercase before validating so `  Foo@Bar.com ` is accepted. */
export const emailSchema = z.preprocess(
	(value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
	z.email().max(254),
);

export const passwordSchema = z.string().min(8).max(200);

export const nameSchema = z.string().trim().min(1).max(120);

export const registerSchema = z.object({
	email: emailSchema,
	password: passwordSchema,
	name: nameSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
	email: emailSchema,
	password: passwordSchema,
});
export type LoginInput = z.infer<typeof loginSchema>;

// --- Accounts, roles & business information -----------------------------------

// `Role` itself is the source-of-truth union in `types.ts` (mirrors the
// `ItemStatus`/`itemStatusSchema` split); here we only need the runtime schema.
/** Every role a member can hold. */
export const roleSchema = z.enum(['owner', 'manager', 'team_member']);

/** Roles that can be granted to an invited member (ownership is not invitable). */
export const assignableRoleSchema = z.enum(['manager', 'team_member']);

export const businessNameSchema = z.string().trim().min(1).max(160);
export const phoneSchema = z.string().trim().max(40);
export const addressSchema = z.string().trim().max(300);
export const timezoneSchema = z.string().trim().max(64);
/** A website URL, or an empty string when none is provided. */
export const websiteSchema = z
	.string()
	.trim()
	.max(2048)
	.refine((value) => value === '' || z.url().safeParse(value).success, {
		message: 'Must be a valid URL',
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
 * Sign up: create the owner's user, the business account, and the owner
 * membership in one step. `name` is the person; `business.businessName` is the
 * company.
 */
export const signupSchema = registerSchema.extend({
	business: accountBusinessSchema,
});
export type SignupInput = z.infer<typeof signupSchema>;

/** Invite a new Manager or Team Member to an existing account. */
export const inviteMemberSchema = z.object({
	email: emailSchema,
	name: nameSchema,
	role: assignableRoleSchema,
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

/** Accept an invitation: the invitee sets their password using the token. */
export const acceptInviteSchema = z.object({
	token: z.string().min(1),
	password: passwordSchema,
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

/** Change an existing member's role (owner-only). */
export const updateMemberRoleSchema = z.object({
	role: roleSchema,
});
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

export const itemStatusSchema = z.enum(['active', 'archived']);

export const createItemSchema = z.object({
	name: nameSchema,
	description: z.string().trim().max(2000).default(''),
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
		description: z.string().trim().max(2000).optional(),
		status: itemStatusSchema.optional(),
	})
	.refine((value) => Object.values(value).some((field) => field !== undefined), {
		message: 'At least one field must be provided',
	});
export type UpdateItemInput = z.infer<typeof updateItemSchema>;

/** Query string for list endpoints; coerces `?page=2&pageSize=50`. */
export const paginationQuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

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

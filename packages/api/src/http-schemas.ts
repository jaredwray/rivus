import { itemStatusSchema, roleSchema } from '@rivus/core';
import { z } from 'zod';

/** Public user projection — never includes the password hash. */
export const userResponseSchema = z
	.object({
		id: z.string(),
		email: z.string(),
		name: z.string(),
		createdAt: z.string(),
		updatedAt: z.string(),
	})
	.meta({ id: 'User' });

/** A business account. */
export const accountResponseSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		slug: z.string(),
		phone: z.string(),
		address: z.string(),
		website: z.string(),
		timezone: z.string(),
		createdAt: z.string(),
		updatedAt: z.string(),
	})
	.meta({ id: 'Account' });

/** A signed-in session: the JWT plus the user, their account, and their role. */
export const authResponseSchema = z
	.object({
		token: z.string(),
		user: userResponseSchema,
		account: accountResponseSchema,
		role: roleSchema,
	})
	.meta({ id: 'AuthResponse' });

/** Current-session view returned from `GET /v1/auth/me`. */
export const sessionResponseSchema = z
	.object({
		user: userResponseSchema,
		account: accountResponseSchema,
		role: roleSchema,
	})
	.meta({ id: 'Session' });

/** A member of an account: their user fields plus role and join date. */
export const memberResponseSchema = z
	.object({
		userId: z.string(),
		email: z.string(),
		name: z.string(),
		role: roleSchema,
		joinedAt: z.string(),
	})
	.meta({ id: 'Member' });

/** A pending or resolved invitation. The token is returned so it can be shared. */
export const inviteResponseSchema = z
	.object({
		id: z.string(),
		email: z.string(),
		name: z.string(),
		role: z.enum(['manager', 'team_member']),
		status: z.enum(['pending', 'accepted', 'revoked']),
		token: z.string(),
		createdAt: z.string(),
	})
	.meta({ id: 'Invite' });

export const memberListResponseSchema = z
	.object({
		members: z.array(memberResponseSchema),
		invites: z.array(inviteResponseSchema),
	})
	.meta({ id: 'MemberList' });

export const itemResponseSchema = z
	.object({
		id: z.string(),
		accountId: z.string(),
		name: z.string(),
		description: z.string(),
		status: itemStatusSchema,
		createdAt: z.string(),
		updatedAt: z.string(),
	})
	.meta({ id: 'Item' });

export const paginationMetaSchema = z.object({
	page: z.number().int(),
	pageSize: z.number().int(),
	total: z.number().int(),
	totalPages: z.number().int(),
	hasNextPage: z.boolean(),
	hasPreviousPage: z.boolean(),
});

export const itemListResponseSchema = z
	.object({
		data: z.array(itemResponseSchema),
		meta: paginationMetaSchema,
	})
	.meta({ id: 'ItemList' });

export const errorResponseSchema = z
	.object({
		error: z.string(),
		message: z.string(),
		statusCode: z.number().int(),
		details: z.unknown().optional(),
	})
	.meta({ id: 'Error' });

export const idParamsSchema = z.object({
	id: z.string().min(1),
});

export const healthResponseSchema = z.object({
	status: z.literal('ok'),
	uptime: z.number(),
	timestamp: z.string(),
});

export const readyResponseSchema = z.object({
	status: z.literal('ready'),
});

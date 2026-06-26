import { accountStatusSchema, faqStatusSchema, itemStatusSchema, roleSchema } from '@rivus/core';
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
		status: accountStatusSchema,
		canceledAt: z.string().nullable(),
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

/**
 * Acknowledges that a one-time code was emailed. Signup and login return this
 * (HTTP 202) instead of a session — the session is issued later by `verify`.
 */
export const codeSentResponseSchema = z
	.object({
		status: z.literal('code_sent'),
		email: z.string(),
	})
	.meta({ id: 'CodeSent' });

/** Acknowledges that the session cookie was cleared by `POST /v1/auth/logout`. */
export const signedOutResponseSchema = z
	.object({
		status: z.literal('signed_out'),
	})
	.meta({ id: 'SignedOut' });

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

/**
 * A pending invitation as shown in the roster. The bearer `token` is deliberately
 * omitted here — anyone who can list members (including Members) would otherwise
 * be able to claim a pending Manager or Owner invite.
 */
export const inviteSummarySchema = z
	.object({
		id: z.string(),
		email: z.string(),
		name: z.string(),
		role: roleSchema,
		status: z.enum(['pending', 'accepted', 'revoked']),
		createdAt: z.string(),
	})
	.meta({ id: 'InviteSummary' });

/** The invitation as returned to its creator — includes the shareable `token`. */
export const inviteResponseSchema = inviteSummarySchema
	.extend({ token: z.string() })
	.meta({ id: 'Invite' });

export const memberListResponseSchema = z
	.object({
		members: z.array(memberResponseSchema),
		invites: z.array(inviteSummarySchema),
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

export const faqResponseSchema = z
	.object({
		id: z.string(),
		accountId: z.string(),
		question: z.string(),
		answer: z.string(),
		category: z.string(),
		status: faqStatusSchema,
		createdAt: z.string(),
		updatedAt: z.string(),
	})
	.meta({ id: 'Faq' });

export const faqListResponseSchema = z
	.object({
		data: z.array(faqResponseSchema),
		meta: paginationMetaSchema,
	})
	.meta({ id: 'FaqList' });

/**
 * Result of the AI duplicate check run before creating an FAQ. `match` is the
 * existing FAQ a new one would duplicate (or null when none is similar), and
 * `merged` is the AI-combined question/answer the client offers as an update.
 */
export const faqSimilarityResponseSchema = z
	.object({
		match: faqResponseSchema.nullable(),
		reason: z.string(),
		merged: z.object({ question: z.string(), answer: z.string() }).nullable(),
	})
	.meta({ id: 'FaqSimilarity' });

/** A page of companies (accounts) for the staff company switcher. */
export const accountListResponseSchema = z
	.object({
		data: z.array(accountResponseSchema),
		meta: paginationMetaSchema,
	})
	.meta({ id: 'AccountList' });

/**
 * Billing summary for the account (owner-only). Rivus has no payment provider
 * wired up yet, so this is a placeholder: every account is on the free plan and
 * `seats` reflects the current member count.
 */
export const billingResponseSchema = z
	.object({
		plan: z.literal('free'),
		status: accountStatusSchema,
		seats: z.number().int(),
	})
	.meta({ id: 'Billing' });

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

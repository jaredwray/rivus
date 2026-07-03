import {
	accountStatusSchema,
	conversationChannelSchema,
	conversationStatusSchema,
	faqStatusSchema,
	itemStatusSchema,
	jobStatusSchema,
	messageAuthorSchema,
	notificationReadStateSchema,
	notificationTypeSchema,
	roleSchema,
} from '@rivus/core';
import { z } from 'zod';

/**
 * The public projection of an account, for unauthenticated surfaces (the
 * customer self-signup page): just enough to say who the visitor is joining —
 * no phone, address, status, or timestamps.
 */
export const publicAccountResponseSchema = z
	.object({
		name: z.string(),
		slug: z.string(),
	})
	.meta({ id: 'PublicAccount' });

/**
 * Acknowledges a customer self-signup. Deliberately the same shape whether the
 * record was created or the email already belonged to a customer, so the
 * public endpoint can't be used to probe who is in an account's CRM.
 */
export const publicCustomerSignupResponseSchema = z
	.object({
		status: z.literal('registered'),
	})
	.meta({ id: 'PublicCustomerSignupResult' });

/** Public user projection — never includes the password hash. */
export const userResponseSchema = z
	.object({
		id: z.string(),
		email: z.string(),
		name: z.string(),
		phone: z.string(),
		/** A new email awaiting verification, or `''` when no change is pending. */
		pendingEmail: z.string(),
		avatarUrl: z.string(),
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
		/**
		 * Domain of the account's inbound agent address (`AGENT_EMAIL_DOMAIN`), so a
		 * client can show/share the address customers email — `<account.slug>@<this>`
		 * — without hardcoding the domain. Global config, not per-account data, so it
		 * rides on the session rather than the account object.
		 */
		agentEmailDomain: z.string(),
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
		/** Domain of the account's inbound agent address; see {@link authResponseSchema}. */
		agentEmailDomain: z.string(),
	})
	.meta({ id: 'Session' });

/** A member of an account: their user fields plus role and join date. */
export const memberResponseSchema = z
	.object({
		userId: z.string(),
		email: z.string(),
		name: z.string(),
		avatarUrl: z.string(),
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

export const customerResponseSchema = z
	.object({
		id: z.string(),
		accountId: z.string(),
		name: z.string(),
		email: z.string(),
		phone: z.string(),
		address: z.string(),
		lifetimeValue: z.number().int(),
		balance: z.number().int(),
		notes: z.string(),
		createdAt: z.string(),
		updatedAt: z.string(),
	})
	.meta({ id: 'Customer' });

export const customerListResponseSchema = z
	.object({
		data: z.array(customerResponseSchema),
		meta: paginationMetaSchema,
	})
	.meta({ id: 'CustomerList' });

export const jobResponseSchema = z
	.object({
		id: z.string(),
		accountId: z.string(),
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
	})
	.meta({ id: 'Job' });

export const jobListResponseSchema = z
	.object({
		data: z.array(jobResponseSchema),
		meta: paginationMetaSchema,
	})
	.meta({ id: 'JobList' });

/**
 * Result of the dashboard's global search: the account's customers and jobs whose
 * text fields match the query, each list independently capped by the query's
 * `limit`. Grouped by type so the client can render labelled sections; more types
 * (messages, …) can be added here as they become searchable.
 */
export const searchResponseSchema = z
	.object({
		customers: z.array(customerResponseSchema),
		jobs: z.array(jobResponseSchema),
	})
	.meta({ id: 'SearchResults' });

export const notificationResponseSchema = z
	.object({
		id: z.string(),
		accountId: z.string(),
		userId: z.string(),
		type: notificationTypeSchema,
		title: z.string(),
		body: z.string(),
		readState: notificationReadStateSchema,
		linkHref: z.string(),
		createdAt: z.string(),
		updatedAt: z.string(),
	})
	.meta({ id: 'Notification' });

export const notificationListResponseSchema = z
	.object({
		data: z.array(notificationResponseSchema),
		meta: paginationMetaSchema,
	})
	.meta({ id: 'NotificationList' });

/** The number of unread notifications, for the bell badge. */
export const unreadCountResponseSchema = z
	.object({
		unread: z.number().int(),
	})
	.meta({ id: 'NotificationUnreadCount' });

/** Result of marking every notification read: how many were changed. */
export const markAllReadResponseSchema = z
	.object({
		updated: z.number().int(),
	})
	.meta({ id: 'NotificationMarkAllRead' });

export const conversationResponseSchema = z
	.object({
		id: z.string(),
		accountId: z.string(),
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
	})
	.meta({ id: 'Conversation' });

export const conversationListResponseSchema = z
	.object({
		data: z.array(conversationResponseSchema),
		meta: paginationMetaSchema,
	})
	.meta({ id: 'ConversationList' });

export const messageResponseSchema = z
	.object({
		id: z.string(),
		conversationId: z.string(),
		author: messageAuthorSchema,
		body: z.string(),
		createdAt: z.string(),
	})
	.meta({ id: 'Message' });

/** A conversation together with its full transcript (the thread detail view). */
export const conversationDetailResponseSchema = z
	.object({
		conversation: conversationResponseSchema,
		messages: z.array(messageResponseSchema),
	})
	.meta({ id: 'ConversationDetail' });

/** How many conversations need a human, for the Inbox sidebar badge. */
export const needsAttentionCountResponseSchema = z
	.object({
		count: z.number().int(),
	})
	.meta({ id: 'ConversationNeedsAttentionCount' });

/** The jobs that would overlap a proposed booking for one team member. */
export const jobConflictResponseSchema = z
	.object({
		conflicts: z.array(jobResponseSchema),
	})
	.meta({ id: 'JobConflicts' });

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

/**
 * Result of answering a question from the knowledge base (AI-assisted). `answered`
 * is false when the FAQs don't cover the question; `answer` is then empty. `sources`
 * lists the FAQ(s) the answer draws on so the client can cite where it came from.
 */
export const faqAnswerResponseSchema = z
	.object({
		answered: z.boolean(),
		answer: z.string(),
		sources: z.array(z.object({ id: z.string(), question: z.string() })),
	})
	.meta({ id: 'FaqAnswer' });

/** A page of companies (accounts) for the staff company switcher. */
export const accountListResponseSchema = z
	.object({
		data: z.array(accountResponseSchema),
		meta: paginationMetaSchema,
	})
	.meta({ id: 'AccountList' });

/**
 * Tally returned by the development-only account seeder (`POST /v1/admin/seed`):
 * how many of each entity were written, the FAQs skipped as duplicates, the
 * member count the notifications were addressed to, and which generator produced
 * the data.
 */
export const seedSummaryResponseSchema = z
	.object({
		customers: z.number().int(),
		faqs: z.number().int(),
		faqsSkipped: z.number().int(),
		appointments: z.number().int(),
		notifications: z.number().int(),
		conversations: z.number().int(),
		members: z.number().int(),
		generation: z.enum(['ai', 'deterministic']),
	})
	.meta({ id: 'SeedSummary' });

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

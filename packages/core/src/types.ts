/**
 * Branded id type so a `UserId` can never be passed where an `ItemId` is
 * expected, even though both are strings at runtime.
 */
export type Id<TBrand extends string> = string & { readonly __brand: TBrand };

export type UserId = Id<'User'>;
export type ItemId = Id<'Item'>;
export type FaqId = Id<'Faq'>;
export type CustomerId = Id<'Customer'>;
export type JobId = Id<'Job'>;
export type AccountId = Id<'Account'>;
export type MembershipId = Id<'Membership'>;
export type InviteId = Id<'Invite'>;
export type NotificationId = Id<'Notification'>;
export type ConversationId = Id<'Conversation'>;
export type MessageId = Id<'Message'>;
export type AgentThreadId = Id<'AgentThread'>;

/** ISO-8601 timestamp, e.g. `2026-06-19T12:00:00.000Z`. */
export type IsoDateString = string;

export interface User {
	id: UserId;
	email: string;
	name: string;
	/** Personal contact phone; empty string when not provided. */
	phone: string;
	/**
	 * A new email address awaiting confirmation, or `''` when none is pending.
	 * Changing your email doesn't take effect until you verify a one-time code
	 * sent to the new address — until then the live `email` is unchanged and this
	 * holds the address being moved to.
	 */
	pendingEmail: string;
	/** Profile image URL — a custom override if one is set, else the Gravatar derived from `email`. */
	avatarUrl: string;
	createdAt: IsoDateString;
	updatedAt: IsoDateString;
}

/**
 * A role within a business account, in ascending order of privilege:
 * - `member` — works in the account's data; cannot invite or manage members.
 * - `manager` — everything a member can, plus inviting/removing members and
 *   managing roles, but not billing or account settings.
 * - `owner` — full control, including billing, account settings, and canceling
 *   the account.
 */
export type Role = 'owner' | 'manager' | 'member';

/**
 * Lifecycle of an account. `canceled` is a soft delete: the owner closed the
 * account but its data is retained (and access is blocked) rather than purged.
 */
export type AccountStatus = 'active' | 'canceled';

/**
 * A messaging channel an account can provision a customer-facing identifier for.
 * Email is deliberately excluded — its address is derived from the account
 * (`agentEmailLocalPart(slug, id)`), needs no provisioning, and is always on —
 * so `channels` only tracks the ones with an externally-assigned identifier.
 */
export type ProvisionedChannel = 'whatsapp' | 'sms' | 'voice';

/** One provisioned channel's per-account configuration. */
export interface AccountChannelConfig {
	/** Whether the channel is turned on — inbound is handled and the identifier is shown. */
	enabled: boolean;
	/**
	 * The provisioned, customer-facing identifier (an E.164 phone number for
	 * whatsapp/sms/voice); `''` until provisioned. Retained when the channel is
	 * disabled so re-enabling restores the same number.
	 */
	address: string;
	/** The provider's opaque reference for the provisioned resource; `''` when none. */
	providerRef: string;
}

/**
 * Every provisioned channel's config, one key per {@link ProvisionedChannel}.
 * All keys are always present (defaulting to off/empty) so a channel's config is
 * a plain read, never an existence check.
 */
export type AccountChannels = Record<ProvisionedChannel, AccountChannelConfig>;

/** A business account — the tenant that owns all of its members' data. */
export interface Account {
	id: AccountId;
	/** Business name shown throughout the product. */
	name: string;
	/** URL-safe, unique handle derived from the business name. */
	slug: string;
	phone: string;
	address: string;
	website: string;
	/** IANA time zone, e.g. `America/Los_Angeles`. */
	timezone: string;
	/**
	 * Provisioned messaging channels (WhatsApp today; SMS and voice reserved).
	 * Email is derived from `slug`+`id`, always on, and never stored here.
	 */
	channels: AccountChannels;
	/** Lifecycle state; `canceled` accounts are soft-deleted and locked out. */
	status: AccountStatus;
	/** When the account was canceled, or `null` while it is active. */
	canceledAt: IsoDateString | null;
	createdAt: IsoDateString;
	updatedAt: IsoDateString;
}

/** Join between a {@link User} and an {@link Account}, carrying the user's role. */
export interface Membership {
	id: MembershipId;
	accountId: AccountId;
	userId: UserId;
	role: Role;
	createdAt: IsoDateString;
	updatedAt: IsoDateString;
}

/** Status of an outstanding invitation to join an account. */
export type InviteStatus = 'pending' | 'accepted' | 'revoked';

/** An invitation for a new member to join an account with a given role. */
export interface Invite {
	id: InviteId;
	accountId: AccountId;
	email: string;
	name: string;
	role: Role;
	status: InviteStatus;
	/** Opaque token the invitee presents to accept the invitation. */
	token: string;
	invitedBy: UserId;
	createdAt: IsoDateString;
	updatedAt: IsoDateString;
}

export type ItemStatus = 'active' | 'archived';

export interface Item {
	id: ItemId;
	/** The account that owns this item; all members share the account's items. */
	accountId: AccountId;
	name: string;
	description: string;
	status: ItemStatus;
	createdAt: IsoDateString;
	updatedAt: IsoDateString;
}

/**
 * Whether an FAQ is live. `published` FAQs are the ones Rivus draws on to answer
 * customers; `draft` keeps an answer staged but unused until it's ready.
 */
export type FaqStatus = 'published' | 'draft';

/** A question-and-answer entry in an account's knowledge base. */
export interface Faq {
	id: FaqId;
	/** The account that owns this FAQ; all members share the account's FAQs. */
	accountId: AccountId;
	question: string;
	answer: string;
	/** Free-text grouping (e.g. "Pricing", "Scheduling"); empty when uncategorized. */
	category: string;
	status: FaqStatus;
	createdAt: IsoDateString;
	updatedAt: IsoDateString;
}

/** A CRM contact owned by an account; all members share the account's customers. */
export interface Customer {
	id: CustomerId;
	accountId: AccountId;
	name: string;
	/** Empty string when not provided. */
	email: string;
	/** Empty string when not provided. */
	phone: string;
	/** Street address; empty string when not provided. */
	address: string;
	/** Lifetime value in integer cents. */
	lifetimeValue: number;
	/** Outstanding balance in integer cents. */
	balance: number;
	/** Free-text notes; empty string when none. */
	notes: string;
	createdAt: IsoDateString;
	updatedAt: IsoDateString;
}

/**
 * Lifecycle of a scheduled job, in the order it typically advances:
 * - `scheduled` — booked but not yet confirmed with the customer.
 * - `confirmed` — the customer confirmed the appointment.
 * - `in_progress` — a technician is on site / actively working.
 * - `completed` — the work is finished.
 * - `canceled` — called off; retained for history but ignored by conflict checks.
 */
export type JobStatus = 'scheduled' | 'confirmed' | 'in_progress' | 'completed' | 'canceled';

/**
 * A scheduled job (appointment) on an account's calendar — the unit the
 * scheduling system books, assigns, and tracks. Owned by an account; all members
 * share the account's jobs.
 */
export interface Job {
	id: JobId;
	accountId: AccountId;
	/**
	 * The customer this job is for, or an empty string for a job not tied to a
	 * customer (e.g. a "hold" block kept open for emergencies). Referential
	 * integrity (the customer exists in this account) is enforced on write.
	 */
	customerId: string;
	/**
	 * The team member assigned to the job (a user id), or an empty string when
	 * unassigned. Enforced on write to be a current member of the account.
	 */
	assignedUserId: string;
	/** Service title, e.g. "Water heater install". */
	title: string;
	status: JobStatus;
	/** Scheduled start as an ISO-8601 UTC instant, e.g. `2026-06-24T21:00:00.000Z`. */
	startAt: IsoDateString;
	/** Duration in whole minutes; the end is `startAt + durationMinutes`. */
	durationMinutes: number;
	/**
	 * Service address for this specific job; an empty string means "use the
	 * customer's address on file" (the UI falls back to it).
	 */
	address: string;
	/** Free-text notes; empty string when none. */
	notes: string;
	/** Estimated value of the job in integer cents (for pipeline totals). */
	estimatedValue: number;
	createdAt: IsoDateString;
	updatedAt: IsoDateString;
}

/**
 * Category of a notification, used to pick an icon/treatment in the UI and to
 * explain why it was sent. `system` is the catch-all for account-level or
 * manually-seeded messages that don't fit a more specific event.
 */
export type NotificationType =
	| 'job_assigned'
	| 'job_updated'
	| 'job_canceled'
	| 'invite_accepted'
	| 'role_changed'
	| 'system';

/** Whether the recipient has opened a notification yet. */
export type NotificationReadState = 'unread' | 'read';

/**
 * A personal notification addressed to one user within an account. Notifications
 * are created as side-effects of domain events (a job assigned to you, an invite
 * you sent being accepted, your role changing) — never written directly by a
 * client. Every record is scoped by both `accountId` and `userId`, so a member
 * only ever sees their own.
 */
export interface Notification {
	id: NotificationId;
	/** The account this notification belongs to. */
	accountId: AccountId;
	/** The user it is addressed to (the recipient). */
	userId: UserId;
	type: NotificationType;
	/** Short headline, e.g. "New job assigned to you". */
	title: string;
	/** Supporting line; empty string when there's nothing more to say. */
	body: string;
	readState: NotificationReadState;
	/** In-app route the notification deep-links to (e.g. `/schedule`); empty when none. */
	linkHref: string;
	createdAt: IsoDateString;
	updatedAt: IsoDateString;
}

/**
 * The channel a customer conversation arrives on. Stored lower-case and canonical;
 * the UI maps each to a display label ("WhatsApp", "SMS") and a channel colour.
 */
export type ConversationChannel = 'whatsapp' | 'phone' | 'email' | 'sms';

/**
 * Where a conversation stands with Rivus:
 * - `rivus_handling` — Rivus is auto-replying from the knowledge base; nothing is
 *   needed from the team.
 * - `needs_attention` — Rivus paused for a human: it drafted a reply it wants
 *   approved (e.g. a billing dispute), or it couldn't answer. The team is on the
 *   hook. This is what the red "Needs you" filter and the sidebar badge count.
 * - `resolved` — the thread is closed; no further action.
 */
export type ConversationStatus = 'rivus_handling' | 'needs_attention' | 'resolved';

/**
 * Who authored a message in a conversation:
 * - `customer` — the external customer (left side of the thread).
 * - `rivus` — Rivus's AI reply (right side, with the Rivus mark).
 * - `agent` — a human team member's reply (right side, with their avatar).
 * - `note` — a system note Rivus drops inline (centered pill), e.g. "Rivus booked…".
 */
export type MessageAuthor = 'customer' | 'rivus' | 'agent' | 'note';

/**
 * A single customer conversation (thread) owned by an account; all members share
 * the account's inbox. The message transcript is stored separately and fetched
 * with the conversation detail — list responses carry only the metadata below.
 */
export interface Conversation {
	id: ConversationId;
	accountId: AccountId;
	/**
	 * The linked CRM {@link Customer}, or an empty string for a lead with no
	 * customer record yet. When set, the context panel derives the customer's
	 * phone, lifetime value, and balance from it. Existence is enforced on write.
	 */
	customerId: string;
	/** Display name of the contact (denormalized so leads without a customer still show a name). */
	contactName: string;
	/** Contact phone for this thread's channel; empty string when none. */
	contactPhone: string;
	channel: ConversationChannel;
	status: ConversationStatus;
	/** One-line preview of the most recent message, kept in sync as messages arrive. */
	snippet: string;
	/** Free-text tags shown in the context panel (e.g. "Repeat client", "Billing flag"). */
	tags: string[];
	/** Last-invoice label for the billing card (e.g. "#1051 · $540 · Due Jun 30"); empty when none. */
	lastInvoice: string;
	/**
	 * Rivus's held draft reply awaiting human approval; empty string when there's
	 * nothing pending. Only meaningful while `status` is `needs_attention`.
	 */
	pendingReply: string;
	/**
	 * Why Rivus paused for review (shown in the approve banner); empty when the
	 * thread isn't flagged.
	 */
	flagReason: string;
	/** When the most recent message arrived — drives list ordering and the row time. */
	lastMessageAt: IsoDateString;
	createdAt: IsoDateString;
	updatedAt: IsoDateString;
}

/** One message in a {@link Conversation}'s transcript. Append-only. */
export interface Message {
	id: MessageId;
	conversationId: ConversationId;
	author: MessageAuthor;
	/** Message text (or the note text when `author` is `note`). */
	body: string;
	createdAt: IsoDateString;
}

/** A conversation together with its full message transcript (the detail view). */
export interface ConversationDetail {
	conversation: Conversation;
	messages: Message[];
}

/**
 * Where an agent-driven scheduling thread stands, in the order it typically
 * advances:
 * - `new` — the contact has written but the agent hasn't resolved them yet.
 * - `awaiting_signup` — the sender isn't a customer; they were sent a link to
 *   add themselves and the agent is waiting for them to write back.
 * - `slots_offered` — the agent proposed appointment times and is waiting for
 *   the contact to pick one (or suggest their own).
 * - `booked` — a job was created and confirmed; a later message that asks for
 *   more scheduling starts a fresh round, while one that merely acknowledges the
 *   booking ("Confirmed!", "thanks") is reassured without reopening scheduling.
 */
export type AgentThreadState = 'new' | 'awaiting_signup' | 'slots_offered' | 'booked';

/** One appointment window the agent offered or booked: a UTC instant + length. */
export interface AgentSlot {
	/** Slot start as an ISO-8601 UTC instant, e.g. `2026-07-07T16:00:00.000Z`. */
	startAt: IsoDateString;
	/** Slot length in whole minutes; the end is `startAt + durationMinutes`. */
	durationMinutes: number;
}

/**
 * The agent's per-contact state for one messaging channel — what makes a
 * multi-turn exchange (offer times, pick one, book) resumable when the next
 * message arrives hours later. One thread exists per
 * `(account, channel, contactAddress)`; the human-readable transcript lives on
 * the linked {@link Conversation}, so this record carries only the machine
 * state the next turn needs. Channel-agnostic on purpose: email today, SMS and
 * WhatsApp threads reuse the same shape with their own `contactAddress` form.
 */
export interface AgentThread {
	id: AgentThreadId;
	accountId: AccountId;
	/** The messaging channel this thread lives on (same union the inbox uses). */
	channel: ConversationChannel;
	/** The contact's channel address — an email address for `email`, a phone number for `sms`. */
	contactAddress: string;
	/** The inbox conversation carrying this thread's transcript. */
	conversationId: ConversationId;
	/** The matched CRM {@link Customer}, or an empty string until the sender is validated. */
	customerId: string;
	state: AgentThreadState;
	/** Slots most recently offered; only meaningful while `state` is `slots_offered`. */
	offeredSlots: AgentSlot[];
	/**
	 * Channel-native id of the contact's latest inbound message (the RFC 5322
	 * `Message-ID` for email), so replies can thread; empty when unknown.
	 */
	lastExternalMessageId: string;
	/** Subject of the email thread; empty for channels without subjects. */
	subject: string;
	/** The {@link Job} booked on this thread, or an empty string until one is. */
	bookedJobId: string;
	createdAt: IsoDateString;
	updatedAt: IsoDateString;
}

/** A page of results plus the metadata a client needs to paginate. */
export interface Paginated<T> {
	data: T[];
	meta: PaginationMeta;
}

export interface PaginationMeta {
	page: number;
	pageSize: number;
	total: number;
	totalPages: number;
	hasNextPage: boolean;
	hasPreviousPage: boolean;
}

/** Shape every Rivus API error response follows. */
export interface ApiErrorBody {
	error: string;
	message: string;
	statusCode: number;
	details?: unknown;
}

/** Authenticated user as embedded in a verified JWT. */
export interface AuthTokenPayload {
	sub: UserId;
	email: string;
	/** Active account the token is scoped to. */
	accountId: AccountId;
	/** The user's role in that account. */
	role: Role;
}

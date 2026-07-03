import type {
	Account,
	AccountBusinessInput,
	AccountId,
	AgentSlot,
	AgentThread,
	AgentThreadId,
	AgentThreadState,
	Conversation,
	ConversationChannel,
	ConversationDetail,
	ConversationId,
	ConversationStatus,
	CreateConversationInput,
	CreateCustomerInput,
	CreateFaqInput,
	CreateItemInput,
	CreateJobInput,
	CreateMessageInput,
	CreateNotificationInput,
	Customer,
	CustomerId,
	Faq,
	FaqId,
	Invite,
	InviteId,
	Item,
	ItemId,
	Job,
	JobId,
	JobStatus,
	Membership,
	Message,
	Notification,
	NotificationId,
	Role,
	UpdateConversationInput,
	UpdateCustomerInput,
	UpdateFaqInput,
	UpdateItemInput,
	UpdateJobInput,
	User,
	UserId,
} from '@rivus/core';

/**
 * A user as persisted. Auth is passwordless (one-time email codes), so there is
 * no secret stored on the user record — `StoredUser` is just the public `User`.
 */
export type StoredUser = User;

export interface NewUser {
	email: string;
	name: string;
}

/**
 * Editable profile fields for the signed-in user. Every field is optional so a
 * partial update only touches what the caller sent. `email` is the live sign-in
 * address (only set once a change is verified); `pendingEmail` holds an address
 * awaiting confirmation (set to `''` to clear it). `avatarUrl` is the custom
 * image override; set to `''` to clear it back to the Gravatar default.
 */
export interface UpdateUser {
	name?: string;
	email?: string;
	phone?: string;
	pendingEmail?: string;
	avatarUrl?: string;
}

export interface UserRepository {
	create(input: NewUser): Promise<StoredUser>;
	findByEmail(email: string): Promise<StoredUser | null>;
	findById(id: UserId): Promise<StoredUser | null>;
	/** Fetch many users in one query (the order of the result is not guaranteed). */
	findByIds(ids: UserId[]): Promise<StoredUser[]>;
	/**
	 * Apply a partial profile update; returns the updated user or null when the id
	 * is unknown. Throws {@link ConflictError} on `email` if another user already
	 * owns the address being moved to.
	 */
	update(id: UserId, input: UpdateUser): Promise<StoredUser | null>;
}

// --- Passwordless verification codes -----------------------------------------

export type VerificationPurpose = 'login' | 'signup' | 'email_change';

/** Account details captured at signup, stashed on the code until it's verified. */
export interface PendingSignup {
	name: string;
	business: AccountBusinessInput;
}

/** Who an `email_change` code belongs to, so only that user can redeem it. */
export interface PendingEmailChange {
	userId: UserId;
}

export interface NewVerificationCode {
	email: string;
	purpose: VerificationPurpose;
	/** Hash of the 6-digit code; the plaintext only ever travels by email. */
	codeHash: string;
	/** ISO-8601 instant after which the code is no longer valid. */
	expiresAt: string;
	/** Present for `signup` codes; carries the account to create on verification. */
	signup?: PendingSignup;
	/** Present for `email_change` codes; identifies the user moving addresses. */
	emailChange?: PendingEmailChange;
}

export interface StoredVerificationCode extends NewVerificationCode {
	id: string;
	attempts: number;
	createdAt: string;
}

export interface VerificationCodeRepository {
	/** Store a code for an email, replacing any existing one (one active per email). */
	upsert(input: NewVerificationCode): Promise<StoredVerificationCode>;
	findByEmail(email: string): Promise<StoredVerificationCode | null>;
	/** Bump the wrong-attempt counter; returns the new count (0 if no code exists). */
	incrementAttempts(email: string): Promise<number>;
	/** Atomically remove the code; returns whether this call was the one that removed it. */
	delete(email: string): Promise<boolean>;
}

export interface NewAccount {
	name: string;
	slug: string;
	phone: string;
	address: string;
	website: string;
	timezone: string;
}

/**
 * Editable account business fields (owner-only account settings). Mirrors the
 * stored shape; the route maps the public `businessName` onto `name`. Every
 * field is optional so a partial update only touches what the caller sent.
 */
export interface UpdateAccount {
	name?: string;
	phone?: string;
	address?: string;
	website?: string;
	timezone?: string;
}

/**
 * Options for {@link AccountRepository.list}: a page of accounts, optionally
 * filtered by a free-text `search` over the business name and slug.
 */
export interface ListAccountsOptions {
	page: number;
	pageSize: number;
	/** Case-insensitive substring matched against the account name and slug. */
	search?: string;
}

export interface AccountRepository {
	create(input: NewAccount): Promise<Account>;
	findById(id: AccountId): Promise<Account | null>;
	findBySlug(slug: string): Promise<Account | null>;
	/**
	 * A page of accounts (sorted by name), for the staff company switcher. Only
	 * canceled accounts are excluded, since they can't be entered — every other
	 * account, including one whose stored record predates the `status` field, is
	 * listed.
	 */
	list(options: ListAccountsOptions): Promise<{ accounts: Account[]; total: number }>;
	/** Apply a partial business-info update; returns the updated account or null. */
	update(id: AccountId, input: UpdateAccount): Promise<Account | null>;
	/** Soft-delete: mark the account `canceled` (data retained). Returns it, or null. */
	cancel(id: AccountId): Promise<Account | null>;
}

export interface NewMembership {
	accountId: AccountId;
	userId: UserId;
	role: Role;
}

export interface MembershipRepository {
	create(input: NewMembership): Promise<Membership>;
	/** The single membership for a user (one account per user). */
	findByUserId(userId: UserId): Promise<Membership | null>;
	findByAccountAndUser(accountId: AccountId, userId: UserId): Promise<Membership | null>;
	listByAccount(accountId: AccountId): Promise<Membership[]>;
	updateRole(accountId: AccountId, userId: UserId, role: Role): Promise<Membership | null>;
	delete(accountId: AccountId, userId: UserId): Promise<boolean>;
}

export interface NewInvite {
	accountId: AccountId;
	email: string;
	name: string;
	role: Role;
	token: string;
	invitedBy: UserId;
}

export interface InviteRepository {
	create(input: NewInvite): Promise<Invite>;
	findById(id: InviteId): Promise<Invite | null>;
	findByToken(token: string): Promise<Invite | null>;
	/** Pending invites for an account. */
	listPendingByAccount(accountId: AccountId): Promise<Invite[]>;
	markAccepted(id: InviteId): Promise<Invite | null>;
	revoke(accountId: AccountId, id: InviteId): Promise<boolean>;
}

export interface SignupInput {
	user: NewUser;
	account: NewAccount;
}

export interface SignupResult {
	user: StoredUser;
	account: Account;
	membership: Membership;
}

export interface AcceptInviteInput {
	user: NewUser;
	accountId: AccountId;
	role: Role;
	inviteId: InviteId;
}

export interface AcceptInviteResult {
	user: StoredUser;
	membership: Membership;
}

/**
 * Multi-entity writes that must be atomic. The Mongo implementation runs each in
 * a transaction (hence the replica set); the in-memory implementation writes to
 * a shared store.
 */
export interface OnboardingRepository {
	/** Create user + account + owner membership. */
	signup(input: SignupInput): Promise<SignupResult>;
	/** Create the invitee's user + membership and mark the invite accepted. */
	acceptInvite(input: AcceptInviteInput): Promise<AcceptInviteResult>;
}

export interface ListItemsOptions {
	accountId: AccountId;
	page: number;
	pageSize: number;
}

export interface ItemRepository {
	create(accountId: AccountId, input: CreateItemInput): Promise<Item>;
	list(options: ListItemsOptions): Promise<{ items: Item[]; total: number }>;
	findById(accountId: AccountId, id: ItemId): Promise<Item | null>;
	update(accountId: AccountId, id: ItemId, input: UpdateItemInput): Promise<Item | null>;
	delete(accountId: AccountId, id: ItemId): Promise<boolean>;
}

export interface ListFaqsOptions {
	accountId: AccountId;
	page: number;
	pageSize: number;
}

export interface FaqRepository {
	create(accountId: AccountId, input: CreateFaqInput): Promise<Faq>;
	list(options: ListFaqsOptions): Promise<{ faqs: Faq[]; total: number }>;
	findById(accountId: AccountId, id: FaqId): Promise<Faq | null>;
	update(accountId: AccountId, id: FaqId, input: UpdateFaqInput): Promise<Faq | null>;
	delete(accountId: AccountId, id: FaqId): Promise<boolean>;
}

export interface ListCustomersOptions {
	accountId: AccountId;
	page: number;
	pageSize: number;
}

/**
 * Options for {@link CustomerRepository.search}: a free-text term matched against
 * one account's customers, capped at `limit` matches. Powers the global search
 * box, so it returns a short, newest-first slice rather than a full page.
 */
export interface SearchCustomersOptions {
	accountId: AccountId;
	/** Case-insensitive term matched as a substring of name/email/phone/address/notes. */
	query: string;
	/** Maximum number of matches to return. */
	limit: number;
}

export interface CustomerRepository {
	create(accountId: AccountId, input: CreateCustomerInput): Promise<Customer>;
	list(options: ListCustomersOptions): Promise<{ customers: Customer[]; total: number }>;
	/** Up to `limit` customers matching a free-text term, newest-first (empty term → no matches). */
	search(options: SearchCustomersOptions): Promise<Customer[]>;
	findById(accountId: AccountId, id: CustomerId): Promise<Customer | null>;
	/**
	 * The account's customer with this email address (matched case-insensitively;
	 * the newest record wins if several share it), or null — how the agent
	 * recognizes an inbound sender. An empty email never matches, since customers
	 * without an address on file all store `''`.
	 */
	findByEmail(accountId: AccountId, email: string): Promise<Customer | null>;
	update(
		accountId: AccountId,
		id: CustomerId,
		input: UpdateCustomerInput,
	): Promise<Customer | null>;
	delete(accountId: AccountId, id: CustomerId): Promise<boolean>;
}

/**
 * Options for {@link JobRepository.list}: a page of an account's jobs, optionally
 * narrowed to a `startAt` window (`from` inclusive, `to` exclusive) and/or a
 * single assignee, status, or customer. Results are ordered by `startAt` ascending.
 */
export interface ListJobsOptions {
	accountId: AccountId;
	page: number;
	pageSize: number;
	/** Inclusive lower bound on `startAt` (ISO-8601). */
	from?: string;
	/** Exclusive upper bound on `startAt` (ISO-8601). */
	to?: string;
	assignedUserId?: string;
	status?: JobStatus;
	customerId?: string;
}

/**
 * Options for {@link JobRepository.findOverlapping}: the would-be job's assignee
 * and `[startAt, endAt)` window. Returns that member's non-canceled jobs that
 * overlap the window, excluding `excludeJobId` (the job being edited).
 */
export interface FindOverlappingJobsOptions {
	accountId: AccountId;
	assignedUserId: string;
	/** ISO-8601 start of the window (inclusive). */
	startAt: string;
	/** ISO-8601 end of the window (exclusive). */
	endAt: string;
	excludeJobId?: JobId;
}

/**
 * Options for {@link JobRepository.search}: a free-text term matched against one
 * account's jobs, capped at `limit` matches. The global-search counterpart to the
 * customer search above.
 */
export interface SearchJobsOptions {
	accountId: AccountId;
	/** Case-insensitive term matched as a substring of title/address/notes. */
	query: string;
	/** Maximum number of matches to return. */
	limit: number;
}

export interface JobRepository {
	create(accountId: AccountId, input: CreateJobInput): Promise<Job>;
	list(options: ListJobsOptions): Promise<{ jobs: Job[]; total: number }>;
	/** Up to `limit` jobs matching a free-text term, newest-first (empty term → no matches). */
	search(options: SearchJobsOptions): Promise<Job[]>;
	findById(accountId: AccountId, id: JobId): Promise<Job | null>;
	update(accountId: AccountId, id: JobId, input: UpdateJobInput): Promise<Job | null>;
	delete(accountId: AccountId, id: JobId): Promise<boolean>;
	/** Jobs overlapping a window for one assignee (for double-booking checks). */
	findOverlapping(options: FindOverlappingJobsOptions): Promise<Job[]>;
}

/**
 * Options for {@link NotificationRepository.list}: a page of one user's
 * notifications within an account, optionally narrowed to the unread ones.
 * Results are ordered newest-first.
 */
export interface ListNotificationsOptions {
	accountId: AccountId;
	userId: UserId;
	page: number;
	pageSize: number;
	/** When true, only unread notifications are returned. */
	unreadOnly: boolean;
}

/**
 * Per-user notifications, scoped by both account and recipient. Every method
 * takes the `(accountId, userId)` pair so one member can never read or mutate
 * another's notifications — the same isolation the account-scoped repositories
 * enforce, with the recipient added.
 */
export interface NotificationRepository {
	/** Mint a notification addressed to `userId` within `accountId`. */
	create(
		accountId: AccountId,
		userId: UserId,
		input: CreateNotificationInput,
	): Promise<Notification>;
	list(
		options: ListNotificationsOptions,
	): Promise<{ notifications: Notification[]; total: number }>;
	/** How many of the user's notifications are unread. */
	unreadCount(accountId: AccountId, userId: UserId): Promise<number>;
	findById(accountId: AccountId, userId: UserId, id: NotificationId): Promise<Notification | null>;
	/** Mark one notification read; returns it, or null when it isn't the user's. */
	markRead(accountId: AccountId, userId: UserId, id: NotificationId): Promise<Notification | null>;
	/** Mark every unread notification read; returns how many were changed. */
	markAllRead(accountId: AccountId, userId: UserId): Promise<number>;
	delete(accountId: AccountId, userId: UserId, id: NotificationId): Promise<boolean>;
}

/**
 * Options for {@link ConversationRepository.list}: a page of an account's
 * conversations, newest activity first, optionally narrowed to a single status.
 */
export interface ListConversationsOptions {
	accountId: AccountId;
	page: number;
	pageSize: number;
	/** When set, only conversations in this status are returned. */
	status?: ConversationStatus;
}

/**
 * The server-managed "review state" of a conversation, set as one tuple. These
 * fields aren't part of the public update shape ({@link UpdateConversationInput})
 * because only the inbox flow (Rivus drafting, a human approving) may change them:
 * a held draft and its flag reason always move together with the status.
 */
export interface ConversationReviewPatch {
	status: ConversationStatus;
	/** Rivus's held draft awaiting approval; empty string to clear it. */
	pendingReply: string;
	/** Why Rivus paused; empty string to clear it. */
	flagReason: string;
}

/**
 * Account-scoped inbox of customer conversations. Each conversation owns an
 * append-only message transcript; `list`/`findById` return conversation metadata
 * only (no messages), and {@link listMessages} fetches the transcript on demand —
 * so the thread list stays cheap while the detail view loads the full history.
 */
export interface ConversationRepository {
	create(accountId: AccountId, input: CreateConversationInput): Promise<Conversation>;
	list(
		options: ListConversationsOptions,
	): Promise<{ conversations: Conversation[]; total: number }>;
	findById(accountId: AccountId, id: ConversationId): Promise<Conversation | null>;
	/** Apply a partial metadata update (tags, status, contact, …); returns it, or null. */
	update(
		accountId: AccountId,
		id: ConversationId,
		input: UpdateConversationInput,
	): Promise<Conversation | null>;
	delete(accountId: AccountId, id: ConversationId): Promise<boolean>;
	/** How many of the account's conversations are `needs_attention` (the sidebar badge). */
	needsAttentionCount(accountId: AccountId): Promise<number>;
	/** The transcript for one conversation, oldest-first; null when it isn't the account's. */
	listMessages(accountId: AccountId, id: ConversationId): Promise<Message[] | null>;
	/**
	 * Append a message, refreshing the conversation's `snippet` (skipped for `note`
	 * messages) and `lastMessageAt`. Returns the updated conversation with its full
	 * transcript, or null when the conversation isn't the account's.
	 */
	addMessage(
		accountId: AccountId,
		id: ConversationId,
		input: CreateMessageInput,
	): Promise<ConversationDetail | null>;
	/** Set the server-managed review state (status + held draft + flag); returns it, or null. */
	setReviewState(
		accountId: AccountId,
		id: ConversationId,
		patch: ConversationReviewPatch,
	): Promise<Conversation | null>;
}

/**
 * Shape used to open an agent thread — the identity fields plus the linked
 * conversation. New threads always start in state `new` with nothing offered or
 * booked, so only the identifying fields are taken here.
 */
export interface NewAgentThread {
	accountId: AccountId;
	channel: ConversationChannel;
	/** The contact's channel address (an email address for the email channel). */
	contactAddress: string;
	conversationId: ConversationId;
	/** The matched CRM customer, or '' when the sender isn't recognized yet. */
	customerId: string;
	/** The email thread's subject; '' for channels without subjects. */
	subject: string;
}

/**
 * Machine-state patch applied as the agent advances a thread. Every field is
 * optional so a turn only touches what changed; identity fields (account,
 * channel, address) are immutable for the thread's lifetime.
 */
export interface UpdateAgentThread {
	customerId?: string;
	state?: AgentThreadState;
	offeredSlots?: AgentSlot[];
	lastExternalMessageId?: string;
	subject?: string;
	bookedJobId?: string;
	/** Re-linked only when the team deletes the transcript conversation mid-thread. */
	conversationId?: ConversationId;
}

/**
 * The agent's per-contact scheduling state, one record per
 * `(account, channel, contactAddress)` — the memory that lets a multi-message
 * exchange (offer times → pick one → book) resume when the next inbound
 * message arrives. Uniqueness on that triple is enforced by the store; `create`
 * throws {@link ConflictError} when a concurrent turn already opened the thread.
 */
export interface AgentThreadRepository {
	create(input: NewAgentThread): Promise<AgentThread>;
	findById(accountId: AccountId, id: AgentThreadId): Promise<AgentThread | null>;
	/** The thread for one contact on one channel, or null when they've never written. */
	findByContact(
		accountId: AccountId,
		channel: ConversationChannel,
		contactAddress: string,
	): Promise<AgentThread | null>;
	/**
	 * The thread whose transcript is this conversation, or null when the
	 * conversation isn't agent-driven. How an inbox reply on an email thread
	 * finds the customer's address and the RFC 5322 id to thread under, so a
	 * human's message actually leaves as email instead of only landing in the
	 * transcript.
	 */
	findByConversationId(
		accountId: AccountId,
		conversationId: ConversationId,
	): Promise<AgentThread | null>;
	/** Apply a machine-state patch; returns the updated thread, or null when it isn't the account's. */
	update(
		accountId: AccountId,
		id: AgentThreadId,
		input: UpdateAgentThread,
	): Promise<AgentThread | null>;
}

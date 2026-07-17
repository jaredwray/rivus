import type { AccountId, CreateNotificationInput, Job, Role, UserId } from '@rivus/core';
import type { FastifyBaseLogger } from 'fastify';
import type { NotificationRepository } from '../repositories/types';
import type { WebsiteAuditReport } from './website-audit';

/**
 * Turns domain events into per-user notifications. Routes call these methods
 * *after* their write succeeds; the service decides who (if anyone) should be
 * notified and what the message says, keeping that policy out of the routes.
 *
 * Every method is best-effort: a failure to write a notification is logged and
 * swallowed (see {@link emit}) so a notification outage can never fail the
 * mutation that triggered it. Notifications are a side-effect, not part of the
 * transaction.
 */

/** Common to every event: the account it happened in, plus an optional logger. */
interface BaseArgs {
	accountId: AccountId;
	/** Request logger, used to record (and swallow) a notification write failure. */
	logger?: FastifyBaseLogger;
}

export interface JobEventArgs extends BaseArgs {
	/** The user who performed the action; never notified about their own change. */
	actorId: UserId;
	job: Job;
}

export interface JobUpdatedArgs extends JobEventArgs {
	/**
	 * The job as it was *before* the update. The edit is classified by diffing
	 * `before` against `job` (the result), so a save that re-sends unchanged
	 * fields — as the schedule form does on every edit — doesn't fire a spurious
	 * "reassigned" / "rescheduled" notice.
	 */
	before: Job;
}

export interface InviteAcceptedArgs extends BaseArgs {
	/** The member who sent the invite — the recipient of this notification. */
	inviterId: UserId;
	/** Display name of the teammate who just joined. */
	memberName: string;
	accountName: string;
}

export interface RoleChangedArgs extends BaseArgs {
	/** The user who changed the role; not notified if they changed their own. */
	actorId: UserId;
	/** The member whose role changed — the recipient of this notification. */
	targetUserId: UserId;
	role: Role;
	accountName: string;
}

export interface ConversationNeedsReviewArgs extends BaseArgs {
	/** The user who triggered the draft (e.g. tapped "let Rivus reply"); not notified. */
	actorId: UserId;
	/** The account's members; everyone but the actor is alerted that a thread is waiting. */
	memberIds: UserId[];
	/** The contact whose conversation Rivus paused on, for the message body. */
	contactName: string;
}

export interface WebsiteAuditReadyArgs extends BaseArgs {
	/** The account owner (from signup) — the recipient of the welcome audit. */
	ownerId: UserId;
	/** The audit report to summarize, or null when the site couldn't be loaded. */
	report: WebsiteAuditReport | null;
	/** The URL that was audited (used for the "couldn't reach it" message). */
	url: string;
}

export interface NotificationService {
	/** A job was created; notify its assignee when it isn't the creator. */
	jobCreated(args: JobEventArgs): Promise<void>;
	/** A job was edited; notify the assignee about a reassignment, reschedule, or cancellation. */
	jobUpdated(args: JobUpdatedArgs): Promise<void>;
	/** A job was deleted; notify its assignee when it wasn't the actor. */
	jobDeleted(args: JobEventArgs): Promise<void>;
	/** An invite was accepted; notify the member who sent it. */
	inviteAccepted(args: InviteAcceptedArgs): Promise<void>;
	/** A member's role changed; notify that member (unless they changed it themselves). */
	roleChanged(args: RoleChangedArgs): Promise<void>;
	/** Rivus paused a conversation for a human; alert every member except the actor. */
	conversationNeedsReview(args: ConversationNeedsReviewArgs): Promise<void>;
	/** The welcome website audit finished at signup; summarize it for the new owner. */
	websiteAuditReady(args: WebsiteAuditReadyArgs): Promise<void>;
}

/** Where each notification type deep-links in the app. */
const SCHEDULE_LINK = '/schedule';
const TEAM_LINK = '/team';
const INBOX_LINK = '/inbox';
const SETTINGS_LINK = '/settings';

/** How many failing checks the welcome-audit notification lists before "…and N more". */
const MAX_AUDIT_SUGGESTIONS = 3;

const ROLE_LABELS: Record<Role, string> = {
	owner: 'an Owner',
	manager: 'a Manager',
	member: 'a Member',
};

/** A real notification service backed by the {@link NotificationRepository}. */
class NotificationServiceImpl implements NotificationService {
	constructor(private readonly notifications: NotificationRepository) {}

	/**
	 * Write one notification, swallowing (and logging) any failure. This is the
	 * single place a repository error is caught, so every public method stays
	 * best-effort without repeating the try/catch.
	 */
	private async emit(
		accountId: AccountId,
		recipientId: UserId,
		input: CreateNotificationInput,
		logger?: FastifyBaseLogger,
	): Promise<void> {
		try {
			await this.notifications.create(accountId, recipientId, input);
		} catch (error) {
			logger?.error({ err: error }, 'failed to write notification');
		}
	}

	async jobCreated({ accountId, actorId, job, logger }: JobEventArgs): Promise<void> {
		const assignee = assigneeToNotify(job.assignedUserId, actorId);
		if (!assignee) {
			return;
		}
		await this.emit(
			accountId,
			assignee,
			{
				type: 'job_assigned',
				title: 'New job assigned to you',
				body: job.title,
				linkHref: SCHEDULE_LINK,
			},
			logger,
		);
	}

	async jobUpdated({ accountId, actorId, before, job, logger }: JobUpdatedArgs): Promise<void> {
		// Classify by diffing before -> after (not by which fields were *sent*), so a
		// save that re-submits unchanged fields doesn't raise a spurious notice.
		// Cancellation wins over a reassignment, which wins over a reschedule, so a
		// single edit raises at most one notification (the most consequential one).
		const newlyCanceled = before.status !== 'canceled' && job.status === 'canceled';
		const reassigned = job.assignedUserId !== before.assignedUserId;
		const rescheduled = job.startAt !== before.startAt;

		if (newlyCanceled) {
			const assignee = assigneeToNotify(job.assignedUserId, actorId);
			if (assignee) {
				await this.emit(
					accountId,
					assignee,
					{
						type: 'job_canceled',
						title: 'A job was canceled',
						body: job.title,
						linkHref: SCHEDULE_LINK,
					},
					logger,
				);
			}
			return;
		}
		if (reassigned) {
			// `assigneeToNotify` returns null when the new assignee is empty
			// (unassigned) or the actor, so a clear-assignment edit notifies no one.
			const assignee = assigneeToNotify(job.assignedUserId, actorId);
			if (assignee) {
				await this.emit(
					accountId,
					assignee,
					{
						type: 'job_assigned',
						title: 'New job assigned to you',
						body: job.title,
						linkHref: SCHEDULE_LINK,
					},
					logger,
				);
			}
			return;
		}
		if (rescheduled) {
			const assignee = assigneeToNotify(job.assignedUserId, actorId);
			if (assignee) {
				await this.emit(
					accountId,
					assignee,
					{
						type: 'job_updated',
						title: 'A job was rescheduled',
						body: job.title,
						linkHref: SCHEDULE_LINK,
					},
					logger,
				);
			}
		}
	}

	async jobDeleted({ accountId, actorId, job, logger }: JobEventArgs): Promise<void> {
		const assignee = assigneeToNotify(job.assignedUserId, actorId);
		if (!assignee) {
			return;
		}
		await this.emit(
			accountId,
			assignee,
			{
				type: 'job_canceled',
				title: 'A job was canceled',
				body: job.title,
				linkHref: SCHEDULE_LINK,
			},
			logger,
		);
	}

	async inviteAccepted({
		accountId,
		inviterId,
		memberName,
		accountName,
		logger,
	}: InviteAcceptedArgs): Promise<void> {
		await this.emit(
			accountId,
			inviterId,
			{
				type: 'invite_accepted',
				title: 'Invitation accepted',
				body: `${memberName} joined ${accountName}.`,
				linkHref: TEAM_LINK,
			},
			logger,
		);
	}

	async roleChanged({
		accountId,
		actorId,
		targetUserId,
		role,
		accountName,
		logger,
	}: RoleChangedArgs): Promise<void> {
		// An owner editing their own role shouldn't notify themselves.
		if (targetUserId === actorId) {
			return;
		}
		await this.emit(
			accountId,
			targetUserId,
			{
				type: 'role_changed',
				title: 'Your role changed',
				body: `You're now ${ROLE_LABELS[role]} at ${accountName}.`,
				linkHref: TEAM_LINK,
			},
			logger,
		);
	}

	async conversationNeedsReview({
		accountId,
		actorId,
		memberIds,
		contactName,
		logger,
	}: ConversationNeedsReviewArgs): Promise<void> {
		// The person who asked Rivus to reply already knows it paused, so alert the
		// rest of the team — they're the ones who might pick the thread up.
		const recipients = memberIds.filter((memberId) => memberId !== actorId);
		for (const recipient of recipients) {
			await this.emit(
				accountId,
				recipient,
				{
					type: 'system',
					title: 'A conversation needs you',
					body: `Rivus paused on ${contactName} and is waiting for your review.`,
					linkHref: INBOX_LINK,
				},
				logger,
			);
		}
	}

	async websiteAuditReady({
		accountId,
		ownerId,
		report,
		url,
		logger,
	}: WebsiteAuditReadyArgs): Promise<void> {
		if (report === null) {
			await this.emit(
				accountId,
				ownerId,
				{
					type: 'system',
					title: 'I couldn’t reach your website',
					body: `I tried to review ${url} but couldn’t load it — it may be down or blocking visitors. Once it’s reachable, ask me to “audit my website”.`,
					linkHref: SETTINGS_LINK,
				},
				logger,
			);
			return;
		}
		const failed = report.checks.filter((check) => !check.passed);
		const passed = report.checks.length - failed.length;
		const lines = [
			`I reviewed ${report.url} — ${passed} of ${report.checks.length} checks look good.`,
		];
		if (failed.length === 0) {
			lines.push('', 'Everything I checked looks great. 🎉');
		} else {
			const shown = failed.slice(0, MAX_AUDIT_SUGGESTIONS);
			lines.push('', 'Top things to improve:', ...shown.map((check) => `• ${check.label}`));
			const remaining = failed.length - shown.length;
			if (remaining > 0) {
				lines.push('', `…and ${remaining} more. Ask me to “audit my website” for the full list.`);
			}
		}
		await this.emit(
			accountId,
			ownerId,
			{
				type: 'system',
				title: 'Your website audit is ready',
				body: lines.join('\n'),
				linkHref: SETTINGS_LINK,
			},
			logger,
		);
	}
}

/**
 * The assignee to notify for a job event: the assigned user, unless the slot is
 * empty ("unassigned") or the assignee is the person who made the change (you
 * don't get notified about your own action). Returns the recipient id or null.
 */
function assigneeToNotify(assignedUserId: string, actorId: UserId): UserId | null {
	if (!assignedUserId || assignedUserId === actorId) {
		return null;
	}
	return assignedUserId as UserId;
}

/** Build a notification service over the given repository. */
export function createNotificationService(deps: {
	notifications: NotificationRepository;
}): NotificationService {
	return new NotificationServiceImpl(deps.notifications);
}

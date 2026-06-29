import type { AccountId, CreateNotificationInput, Job, JobId, UserId } from '@rivus/core';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryRepositories, type InMemoryRepositories } from '../src/repositories/memory';
import type { JobRepository, NotificationRepository } from '../src/repositories/types';
import { createNotificationService } from '../src/services/notifications';
import { addMember, authHeader, buildTestApp, buildTestAppWithRepos, signupOwner } from './helpers';

/** Seed a notification straight through the repository (there is no create route). */
function seed(
	repos: InMemoryRepositories,
	accountId: string,
	userId: string,
	overrides: Partial<CreateNotificationInput> = {},
) {
	return repos.notifications.create(accountId as AccountId, userId as UserId, {
		type: 'system',
		title: 'Hello',
		body: '',
		linkHref: '',
		...overrides,
	});
}

describe('notification routes', () => {
	let app: FastifyInstance;
	let repos: InMemoryRepositories;
	let token: string;
	let accountId: string;
	let userId: string;

	beforeEach(async () => {
		({ app, repos } = await buildTestAppWithRepos());
		const owner = await signupOwner(app);
		token = owner.token;
		accountId = owner.account.id;
		userId = owner.user.id;
	});

	afterEach(async () => {
		await app.close();
	});

	it('requires authentication', async () => {
		const response = await app.inject({ method: 'GET', url: '/v1/notifications' });
		expect(response.statusCode).toBe(401);
	});

	it('lists notifications newest-first with pagination metadata', async () => {
		await seed(repos, accountId, userId, { title: 'one' });
		await seed(repos, accountId, userId, { title: 'two' });
		await seed(repos, accountId, userId, { title: 'three' });

		const response = await app.inject({
			method: 'GET',
			url: '/v1/notifications?page=1&pageSize=2',
			headers: authHeader(token),
		});

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.data).toHaveLength(2);
		expect(body.data[0].title).toBe('three');
		expect(body.meta).toMatchObject({
			page: 1,
			pageSize: 2,
			total: 3,
			totalPages: 2,
			hasNextPage: true,
			hasPreviousPage: false,
		});
	});

	it('filters to unread when ?unread=true', async () => {
		const read = await seed(repos, accountId, userId, { title: 'read one' });
		await seed(repos, accountId, userId, { title: 'unread one' });
		await repos.notifications.markRead(accountId as AccountId, userId as UserId, read.id);

		const response = await app.inject({
			method: 'GET',
			url: '/v1/notifications?unread=true',
			headers: authHeader(token),
		});

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.data).toHaveLength(1);
		expect(body.data[0].title).toBe('unread one');
	});

	it('returns everything when ?unread=false', async () => {
		const read = await seed(repos, accountId, userId);
		await seed(repos, accountId, userId);
		await repos.notifications.markRead(accountId as AccountId, userId as UserId, read.id);

		const response = await app.inject({
			method: 'GET',
			url: '/v1/notifications?unread=false',
			headers: authHeader(token),
		});

		expect(response.json().data).toHaveLength(2);
	});

	it('rejects an invalid unread filter (400)', async () => {
		const response = await app.inject({
			method: 'GET',
			url: '/v1/notifications?unread=maybe',
			headers: authHeader(token),
		});
		expect(response.statusCode).toBe(400);
	});

	it('reports the unread count for the bell badge', async () => {
		await seed(repos, accountId, userId);
		await seed(repos, accountId, userId);

		const response = await app.inject({
			method: 'GET',
			url: '/v1/notifications/unread-count',
			headers: authHeader(token),
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ unread: 2 });
	});

	it('marks one notification read', async () => {
		const created = await seed(repos, accountId, userId);

		const response = await app.inject({
			method: 'POST',
			url: `/v1/notifications/${created.id}/read`,
			headers: authHeader(token),
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().readState).toBe('read');

		const count = await app.inject({
			method: 'GET',
			url: '/v1/notifications/unread-count',
			headers: authHeader(token),
		});
		expect(count.json().unread).toBe(0);
	});

	it('returns 404 when marking an unknown notification read', async () => {
		const response = await app.inject({
			method: 'POST',
			url: '/v1/notifications/does-not-exist/read',
			headers: authHeader(token),
		});
		expect(response.statusCode).toBe(404);
	});

	it('marks all notifications read and reports how many changed', async () => {
		await seed(repos, accountId, userId);
		await seed(repos, accountId, userId);
		await seed(repos, accountId, userId);

		const response = await app.inject({
			method: 'POST',
			url: '/v1/notifications/read-all',
			headers: authHeader(token),
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ updated: 3 });

		const count = await app.inject({
			method: 'GET',
			url: '/v1/notifications/unread-count',
			headers: authHeader(token),
		});
		expect(count.json().unread).toBe(0);
	});

	it('dismisses (deletes) a notification, after which it is gone', async () => {
		const created = await seed(repos, accountId, userId);

		const deleteResponse = await app.inject({
			method: 'DELETE',
			url: `/v1/notifications/${created.id}`,
			headers: authHeader(token),
		});
		expect(deleteResponse.statusCode).toBe(204);

		const list = await app.inject({
			method: 'GET',
			url: '/v1/notifications',
			headers: authHeader(token),
		});
		expect(list.json().data).toHaveLength(0);
	});

	it('returns 404 when dismissing an unknown notification', async () => {
		const response = await app.inject({
			method: 'DELETE',
			url: '/v1/notifications/does-not-exist',
			headers: authHeader(token),
		});
		expect(response.statusCode).toBe(404);
	});

	it('does not leak notifications to another user in the same account', async () => {
		const member = await addMember(app, token, 'member', 'teammate@example.com');
		// A notification addressed to the teammate, not to the owner.
		const theirs = await seed(repos, accountId, member.userId, { title: 'for the member' });

		// The owner's list never includes it.
		const ownerList = await app.inject({
			method: 'GET',
			url: '/v1/notifications',
			headers: authHeader(token),
		});
		expect(ownerList.json().data.some((n: { id: string }) => n.id === theirs.id)).toBe(false);

		// And the owner can neither read nor delete it.
		const read = await app.inject({
			method: 'POST',
			url: `/v1/notifications/${theirs.id}/read`,
			headers: authHeader(token),
		});
		expect(read.statusCode).toBe(404);
		const del = await app.inject({
			method: 'DELETE',
			url: `/v1/notifications/${theirs.id}`,
			headers: authHeader(token),
		});
		expect(del.statusCode).toBe(404);

		// The member, however, sees their own.
		const memberList = await app.inject({
			method: 'GET',
			url: '/v1/notifications',
			headers: authHeader(member.token),
		});
		expect(memberList.json().data.some((n: { id: string }) => n.id === theirs.id)).toBe(true);
	});

	it('does not leak notifications across accounts', async () => {
		const mine = await seed(repos, accountId, userId);
		const otherToken = (await signupOwner(app)).token;

		const list = await app.inject({
			method: 'GET',
			url: '/v1/notifications',
			headers: authHeader(otherToken),
		});
		expect(list.json().data).toHaveLength(0);

		const read = await app.inject({
			method: 'POST',
			url: `/v1/notifications/${mine.id}/read`,
			headers: authHeader(otherToken),
		});
		expect(read.statusCode).toBe(404);
	});
});

/**
 * The emission paths: domain mutations should produce notifications for the
 * right recipient. These go through the real routes + the in-memory service.
 */
describe('notification emission from domain events', () => {
	let app: FastifyInstance;
	let token: string;
	let memberToken: string;
	let memberUserId: string;

	beforeEach(async () => {
		({ app } = await buildTestAppWithRepos());
		token = (await signupOwner(app)).token;
		const member = await addMember(app, token, 'member', 'crew@example.com');
		memberToken = member.token;
		memberUserId = member.userId;
	});

	afterEach(async () => {
		await app.close();
	});

	async function listFor(userToken: string) {
		const response = await app.inject({
			method: 'GET',
			url: '/v1/notifications',
			headers: authHeader(userToken),
		});
		return response.json().data as Array<{ type: string; title: string; body: string }>;
	}

	async function createJob(extra: Record<string, unknown> = {}) {
		const response = await app.inject({
			method: 'POST',
			url: '/v1/jobs',
			headers: authHeader(token),
			payload: { title: 'Water heater install', startAt: '2026-07-01T10:00:00.000Z', ...extra },
		});
		return response.json() as Job;
	}

	it('notifies the inviter when an invite is accepted', async () => {
		// addMember (in beforeEach) already had the owner invite + the member accept.
		const ownerNotifications = await listFor(token);
		const accepted = ownerNotifications.find((n) => n.type === 'invite_accepted');
		expect(accepted).toBeDefined();
		expect(accepted?.body).toContain('joined');
	});

	it('notifies the assignee when a job is assigned to them', async () => {
		await createJob({ assignedUserId: memberUserId });

		const memberNotifications = await listFor(memberToken);
		const assigned = memberNotifications.find((n) => n.type === 'job_assigned');
		expect(assigned).toBeDefined();
		expect(assigned?.body).toBe('Water heater install');
	});

	it('does not notify when a job is assigned to yourself', async () => {
		// The owner assigns a job to the owner — the actor is the assignee, so no notice.
		const owner = await app.inject({
			method: 'GET',
			url: '/v1/auth/me',
			headers: authHeader(token),
		});
		const ownerId = owner.json().user.id as string;
		await createJob({ assignedUserId: ownerId });

		const ownerNotifications = await listFor(token);
		expect(ownerNotifications.some((n) => n.type === 'job_assigned')).toBe(false);
	});

	it('notifies the assignee when their job is rescheduled', async () => {
		const job = await createJob({ assignedUserId: memberUserId });
		await app.inject({
			method: 'PATCH',
			url: `/v1/jobs/${job.id}`,
			headers: authHeader(token),
			payload: { startAt: '2026-07-02T10:00:00.000Z' },
		});

		const memberNotifications = await listFor(memberToken);
		expect(memberNotifications[0]?.type).toBe('job_updated');
	});

	it('does not re-notify when an edit re-sends the assignee without changing it', async () => {
		const job = await createJob({ assignedUserId: memberUserId });
		// The schedule form re-sends the full payload (assignedUserId included) even
		// for a note-only edit; that must not read as a reassignment or reschedule.
		await app.inject({
			method: 'PATCH',
			url: `/v1/jobs/${job.id}`,
			headers: authHeader(token),
			payload: { assignedUserId: memberUserId, notes: 'gate code 1234' },
		});

		const memberNotifications = await listFor(memberToken);
		// Only the original assignment — the note-only edit added nothing.
		expect(memberNotifications.filter((n) => n.type === 'job_assigned')).toHaveLength(1);
		expect(memberNotifications.some((n) => n.type === 'job_updated')).toBe(false);
	});

	it('notifies the assignee when their job is canceled', async () => {
		const job = await createJob({ assignedUserId: memberUserId });
		await app.inject({
			method: 'PATCH',
			url: `/v1/jobs/${job.id}`,
			headers: authHeader(token),
			payload: { status: 'canceled' },
		});

		const memberNotifications = await listFor(memberToken);
		expect(memberNotifications[0]?.type).toBe('job_canceled');
	});

	it('notifies the assignee when their job is deleted', async () => {
		const job = await createJob({ assignedUserId: memberUserId });
		await app.inject({
			method: 'DELETE',
			url: `/v1/jobs/${job.id}`,
			headers: authHeader(token),
		});

		const memberNotifications = await listFor(memberToken);
		expect(memberNotifications[0]?.type).toBe('job_canceled');
	});

	it('notifies a member when their role changes', async () => {
		await app.inject({
			method: 'PATCH',
			url: `/v1/members/${memberUserId}/role`,
			headers: authHeader(token),
			payload: { role: 'manager' },
		});

		const memberNotifications = await listFor(memberToken);
		const roleChange = memberNotifications.find((n) => n.type === 'role_changed');
		expect(roleChange).toBeDefined();
		expect(roleChange?.body).toContain('Manager');
	});
});

/** Unit tests for the recipient/classification logic in the notification service. */
describe('createNotificationService', () => {
	const ACCOUNT = 'acct-1' as AccountId;
	const ACTOR = 'actor-1' as UserId;
	const ASSIGNEE = 'user-2' as UserId;

	function makeJob(overrides: Partial<Job> = {}): Job {
		const now = new Date().toISOString();
		return {
			id: 'job-1' as JobId,
			accountId: ACCOUNT,
			customerId: '',
			assignedUserId: '',
			title: 'Test job',
			status: 'scheduled',
			startAt: '2026-07-01T10:00:00.000Z',
			durationMinutes: 60,
			address: '',
			notes: '',
			estimatedValue: 0,
			createdAt: now,
			updatedAt: now,
			...overrides,
		};
	}

	async function unreadFor(repos: InMemoryRepositories, userId: UserId) {
		const { notifications } = await repos.notifications.list({
			accountId: ACCOUNT,
			userId,
			page: 1,
			pageSize: 50,
			unreadOnly: false,
		});
		return notifications;
	}

	it('jobCreated notifies the assignee', async () => {
		const repos = createInMemoryRepositories();
		const notifier = createNotificationService({ notifications: repos.notifications });
		await notifier.jobCreated({
			accountId: ACCOUNT,
			actorId: ACTOR,
			job: makeJob({ assignedUserId: ASSIGNEE }),
		});
		const got = await unreadFor(repos, ASSIGNEE);
		expect(got).toHaveLength(1);
		expect(got[0]?.type).toBe('job_assigned');
	});

	it('jobCreated does not notify when unassigned or self-assigned', async () => {
		const repos = createInMemoryRepositories();
		const notifier = createNotificationService({ notifications: repos.notifications });
		await notifier.jobCreated({ accountId: ACCOUNT, actorId: ACTOR, job: makeJob() });
		await notifier.jobCreated({
			accountId: ACCOUNT,
			actorId: ACTOR,
			job: makeJob({ assignedUserId: ACTOR }),
		});
		expect(await unreadFor(repos, ACTOR)).toHaveLength(0);
	});

	it('jobUpdated classifies cancel, reassign, and reschedule by diffing before/after', async () => {
		const repos = createInMemoryRepositories();
		const notifier = createNotificationService({ notifications: repos.notifications });
		const assigned = makeJob({ assignedUserId: ASSIGNEE });

		// Newly canceled.
		await notifier.jobUpdated({
			accountId: ACCOUNT,
			actorId: ACTOR,
			before: assigned,
			job: makeJob({ assignedUserId: ASSIGNEE, status: 'canceled' }),
		});
		// Rescheduled (start moved, assignee unchanged).
		await notifier.jobUpdated({
			accountId: ACCOUNT,
			actorId: ACTOR,
			before: assigned,
			job: makeJob({ assignedUserId: ASSIGNEE, startAt: '2026-07-02T10:00:00.000Z' }),
		});
		// Reassigned from unassigned to ASSIGNEE.
		await notifier.jobUpdated({
			accountId: ACCOUNT,
			actorId: ACTOR,
			before: makeJob({ assignedUserId: '' }),
			job: makeJob({ assignedUserId: ASSIGNEE }),
		});

		const got = await unreadFor(repos, ASSIGNEE);
		const types = got.map((n) => n.type).sort();
		expect(types).toEqual(['job_assigned', 'job_canceled', 'job_updated']);
	});

	it('jobUpdated stays silent when a re-saved edit changes nothing relevant', async () => {
		const repos = createInMemoryRepositories();
		const notifier = createNotificationService({ notifications: repos.notifications });
		// Same assignee, same start, same status — only the notes differ (as the
		// schedule form re-sending the whole payload would look).
		await notifier.jobUpdated({
			accountId: ACCOUNT,
			actorId: ACTOR,
			before: makeJob({ assignedUserId: ASSIGNEE, notes: 'old' }),
			job: makeJob({ assignedUserId: ASSIGNEE, notes: 'new' }),
		});
		expect(await unreadFor(repos, ASSIGNEE)).toHaveLength(0);
	});

	it('jobDeleted notifies the assignee', async () => {
		const repos = createInMemoryRepositories();
		const notifier = createNotificationService({ notifications: repos.notifications });
		await notifier.jobDeleted({
			accountId: ACCOUNT,
			actorId: ACTOR,
			job: makeJob({ assignedUserId: ASSIGNEE }),
		});
		const got = await unreadFor(repos, ASSIGNEE);
		expect(got[0]?.type).toBe('job_canceled');
	});

	it('inviteAccepted notifies the inviter', async () => {
		const repos = createInMemoryRepositories();
		const notifier = createNotificationService({ notifications: repos.notifications });
		await notifier.inviteAccepted({
			accountId: ACCOUNT,
			inviterId: ACTOR,
			memberName: 'Dana',
			accountName: 'Acme',
		});
		const got = await unreadFor(repos, ACTOR);
		expect(got[0]?.type).toBe('invite_accepted');
		expect(got[0]?.body).toBe('Dana joined Acme.');
	});

	it('roleChanged notifies the target, never the actor', async () => {
		const repos = createInMemoryRepositories();
		const notifier = createNotificationService({ notifications: repos.notifications });
		await notifier.roleChanged({
			accountId: ACCOUNT,
			actorId: ACTOR,
			targetUserId: ASSIGNEE,
			role: 'manager',
			accountName: 'Acme',
		});
		await notifier.roleChanged({
			accountId: ACCOUNT,
			actorId: ACTOR,
			targetUserId: ACTOR,
			role: 'owner',
			accountName: 'Acme',
		});
		expect(await unreadFor(repos, ASSIGNEE)).toHaveLength(1);
		expect(await unreadFor(repos, ACTOR)).toHaveLength(0);
	});

	it('swallows a repository failure (best-effort), with and without a logger', async () => {
		const throwingRepo: NotificationRepository = {
			create: async () => {
				throw new Error('boom');
			},
			list: async () => ({ notifications: [], total: 0 }),
			unreadCount: async () => 0,
			findById: async () => null,
			markRead: async () => null,
			markAllRead: async () => 0,
			delete: async () => false,
		};
		const notifier = createNotificationService({ notifications: throwingRepo });
		const job = makeJob({ assignedUserId: ASSIGNEE });

		// Without a logger the failure is swallowed silently.
		await expect(
			notifier.jobCreated({ accountId: ACCOUNT, actorId: ACTOR, job }),
		).resolves.toBeUndefined();

		// With a logger the failure is recorded, then swallowed.
		const logged: unknown[] = [];
		const logger = { error: (obj: unknown) => logged.push(obj) } as unknown as FastifyBaseLogger;
		await expect(
			notifier.jobCreated({ accountId: ACCOUNT, actorId: ACTOR, job, logger }),
		).resolves.toBeUndefined();
		expect(logged).toHaveLength(1);
	});
});

describe('job delete race', () => {
	it('returns 404 (and does not notify) when the job vanishes before the delete commits', async () => {
		// Simulate a concurrent delete: findById still sees the job, but delete reports
		// "nothing removed". The route must 404 rather than send a cancellation + 204.
		const base = createInMemoryRepositories().jobs;
		const jobs: JobRepository = {
			create: (accountId, input) => base.create(accountId, input),
			list: (options) => base.list(options),
			search: (options) => base.search(options),
			findById: (accountId, id) => base.findById(accountId, id),
			update: (accountId, id, input) => base.update(accountId, id, input),
			delete: async () => false,
			findOverlapping: (options) => base.findOverlapping(options),
		};
		const app = await buildTestApp({ jobs });
		try {
			const token = (await signupOwner(app)).token;
			const created = await app.inject({
				method: 'POST',
				url: '/v1/jobs',
				headers: authHeader(token),
				payload: { title: 'Vanishing job', startAt: '2026-07-01T10:00:00.000Z' },
			});
			const id = created.json().id as string;

			const response = await app.inject({
				method: 'DELETE',
				url: `/v1/jobs/${id}`,
				headers: authHeader(token),
			});
			expect(response.statusCode).toBe(404);
		} finally {
			await app.close();
		}
	});
});

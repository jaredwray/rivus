import {
	type AccountId,
	buildPaginationMeta,
	type CustomerId,
	createJobSchema,
	type JobId,
	jobConflictQuerySchema,
	jobListQuerySchema,
	type UserId,
	updateJobSchema,
} from '@rivus/core';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
	errorResponseSchema,
	idParamsSchema,
	jobConflictResponseSchema,
	jobListResponseSchema,
	jobResponseSchema,
} from '../http-schemas';

/**
 * A job points at a customer and a team member by id. Persisting one that names a
 * customer or member that doesn't exist in this account would create a dangling
 * reference the calendar can never resolve, so validate any non-empty id against
 * the account before the write. Empty ids ("no customer" / "unassigned") are fine.
 */
async function assertReferencesExist(
	app: FastifyInstance,
	accountId: AccountId,
	input: { customerId?: string; assignedUserId?: string },
): Promise<void> {
	if (input.customerId) {
		const customer = await app.deps.customers.findById(accountId, input.customerId as CustomerId);
		if (!customer) {
			throw app.httpErrors.badRequest('That customer does not exist in this account.');
		}
	}
	if (input.assignedUserId) {
		const membership = await app.deps.memberships.findByAccountAndUser(
			accountId,
			input.assignedUserId as UserId,
		);
		if (!membership) {
			throw app.httpErrors.badRequest('That team member is not part of this account.');
		}
	}
}

export const jobRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();
	const { jobs, notifier } = app.deps;

	// Every job route requires a valid JWT.
	app.addHook('onRequest', fastify.authenticate);

	app.get(
		'/',
		{
			schema: {
				tags: ['jobs'],
				summary: "List your account's scheduled jobs",
				security: [{ bearerAuth: [] }],
				querystring: jobListQuerySchema,
				response: {
					200: jobListResponseSchema,
					400: errorResponseSchema,
					401: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const accountId = request.user.accountId as AccountId;
			const { page, pageSize, from, to, assignedUserId, status, customerId } = request.query;
			const { jobs: data, total } = await jobs.list({
				accountId,
				page,
				pageSize,
				from,
				to,
				assignedUserId,
				status,
				customerId,
			});
			return { data, meta: buildPaginationMeta({ page, pageSize, total }) };
		},
	);

	app.post(
		'/',
		{
			schema: {
				tags: ['jobs'],
				summary: 'Schedule a job',
				security: [{ bearerAuth: [] }],
				body: createJobSchema,
				response: { 201: jobResponseSchema, 400: errorResponseSchema, 401: errorResponseSchema },
			},
		},
		async (request, reply) => {
			const accountId = request.user.accountId as AccountId;
			await assertReferencesExist(app, accountId, request.body);
			const job = await jobs.create(accountId, request.body);
			// Notify the assignee (if any, and not the creator) — best-effort.
			await notifier.jobCreated({
				accountId,
				actorId: request.user.sub as UserId,
				job,
				logger: request.log,
			});
			return reply.code(201).send(job);
		},
	);

	// Registered before `/:id` so the literal path isn't shadowed by the param route.
	app.get(
		'/conflicts',
		{
			schema: {
				tags: ['jobs'],
				summary: 'List jobs that would overlap a proposed booking',
				description:
					'Double-booking pre-check: returns the assignee’s non-canceled jobs overlapping ' +
					'the proposed window. Empty when the slot is free.',
				security: [{ bearerAuth: [] }],
				querystring: jobConflictQuerySchema,
				response: {
					200: jobConflictResponseSchema,
					400: errorResponseSchema,
					401: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const accountId = request.user.accountId as AccountId;
			const { assignedUserId, startAt, durationMinutes, excludeJobId } = request.query;
			const endAt = new Date(Date.parse(startAt) + durationMinutes * 60_000).toISOString();
			const conflicts = await jobs.findOverlapping({
				accountId,
				assignedUserId,
				startAt,
				endAt,
				excludeJobId: excludeJobId ? (excludeJobId as JobId) : undefined,
			});
			return { conflicts };
		},
	);

	app.get(
		'/:id',
		{
			schema: {
				tags: ['jobs'],
				summary: 'Fetch one of your jobs',
				security: [{ bearerAuth: [] }],
				params: idParamsSchema,
				response: { 200: jobResponseSchema, 404: errorResponseSchema, 401: errorResponseSchema },
			},
		},
		async (request) => {
			const job = await jobs.findById(
				request.user.accountId as AccountId,
				request.params.id as JobId,
			);
			if (!job) {
				throw app.httpErrors.notFound('Job not found');
			}
			return job;
		},
	);

	app.patch(
		'/:id',
		{
			schema: {
				tags: ['jobs'],
				summary: 'Update or reschedule one of your jobs',
				security: [{ bearerAuth: [] }],
				params: idParamsSchema,
				body: updateJobSchema,
				response: {
					200: jobResponseSchema,
					400: errorResponseSchema,
					404: errorResponseSchema,
					401: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const accountId = request.user.accountId as AccountId;
			const id = request.params.id as JobId;
			await assertReferencesExist(app, accountId, request.body);
			// Capture the prior state so the notifier can diff what actually changed
			// (the schedule form re-sends every field on each save).
			const before = await jobs.findById(accountId, id);
			const job = await jobs.update(accountId, id, request.body);
			if (!job || !before) {
				throw app.httpErrors.notFound('Job not found');
			}
			// Tell the assignee about a reassignment, reschedule, or cancellation.
			await notifier.jobUpdated({
				accountId,
				actorId: request.user.sub as UserId,
				before,
				job,
				logger: request.log,
			});
			return job;
		},
	);

	app.delete(
		'/:id',
		{
			schema: {
				tags: ['jobs'],
				summary: 'Delete one of your jobs',
				security: [{ bearerAuth: [] }],
				params: idParamsSchema,
				response: { 204: z.null(), 401: errorResponseSchema, 404: errorResponseSchema },
			},
		},
		async (request, reply) => {
			const accountId = request.user.accountId as AccountId;
			const id = request.params.id as JobId;
			// Read the job before deleting so its assignee can be notified.
			const job = await jobs.findById(accountId, id);
			if (!job) {
				throw app.httpErrors.notFound('Job not found');
			}
			// A concurrent delete may have removed it between the read and here; only
			// the request that actually deletes it notifies and returns 204.
			const deleted = await jobs.delete(accountId, id);
			if (!deleted) {
				throw app.httpErrors.notFound('Job not found');
			}
			await notifier.jobDeleted({
				accountId,
				actorId: request.user.sub as UserId,
				job,
				logger: request.log,
			});
			return reply.code(204).send(null);
		},
	);
};

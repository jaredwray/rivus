import {
	type AccountId,
	buildPaginationMeta,
	type NotificationId,
	paginationQuerySchema,
	type UserId,
} from '@rivus/core';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
	errorResponseSchema,
	idParamsSchema,
	markAllReadResponseSchema,
	notificationListResponseSchema,
	notificationResponseSchema,
	unreadCountResponseSchema,
} from '../http-schemas';

/** List query: pagination plus an optional unread-only filter (`?unread=true`). */
const notificationListQuerySchema = paginationQuerySchema.extend({
	unread: z.enum(['true', 'false'], { error: 'unread must be true or false.' }).optional(),
});

export const notificationRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();
	const { notifications } = app.deps;

	// Every notification route requires a valid JWT, and is scoped to the
	// authenticated user — a member only ever sees their own notifications.
	app.addHook('onRequest', fastify.authenticate);

	app.get(
		'/',
		{
			schema: {
				tags: ['notifications'],
				summary: 'List your notifications',
				security: [{ bearerAuth: [] }],
				querystring: notificationListQuerySchema,
				response: {
					200: notificationListResponseSchema,
					400: errorResponseSchema,
					401: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const accountId = request.user.accountId as AccountId;
			const userId = request.user.sub as UserId;
			const { page, pageSize, unread } = request.query;
			const { notifications: data, total } = await notifications.list({
				accountId,
				userId,
				page,
				pageSize,
				unreadOnly: unread === 'true',
			});
			return { data, meta: buildPaginationMeta({ page, pageSize, total }) };
		},
	);

	// Registered before `/:id` routes so the literal paths aren't shadowed.
	app.get(
		'/unread-count',
		{
			schema: {
				tags: ['notifications'],
				summary: 'Count your unread notifications (for the bell badge)',
				security: [{ bearerAuth: [] }],
				response: { 200: unreadCountResponseSchema, 401: errorResponseSchema },
			},
		},
		async (request) => {
			const unread = await notifications.unreadCount(
				request.user.accountId as AccountId,
				request.user.sub as UserId,
			);
			return { unread };
		},
	);

	app.post(
		'/read-all',
		{
			schema: {
				tags: ['notifications'],
				summary: 'Mark all your notifications read',
				security: [{ bearerAuth: [] }],
				response: { 200: markAllReadResponseSchema, 401: errorResponseSchema },
			},
		},
		async (request) => {
			const updated = await notifications.markAllRead(
				request.user.accountId as AccountId,
				request.user.sub as UserId,
			);
			return { updated };
		},
	);

	app.post(
		'/:id/read',
		{
			schema: {
				tags: ['notifications'],
				summary: 'Mark one notification read',
				security: [{ bearerAuth: [] }],
				params: idParamsSchema,
				response: {
					200: notificationResponseSchema,
					401: errorResponseSchema,
					404: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const notification = await notifications.markRead(
				request.user.accountId as AccountId,
				request.user.sub as UserId,
				request.params.id as NotificationId,
			);
			if (!notification) {
				throw app.httpErrors.notFound('Notification not found');
			}
			return notification;
		},
	);

	app.delete(
		'/:id',
		{
			schema: {
				tags: ['notifications'],
				summary: 'Dismiss (delete) one of your notifications',
				security: [{ bearerAuth: [] }],
				params: idParamsSchema,
				response: { 204: z.null(), 401: errorResponseSchema, 404: errorResponseSchema },
			},
		},
		async (request, reply) => {
			const deleted = await notifications.delete(
				request.user.accountId as AccountId,
				request.user.sub as UserId,
				request.params.id as NotificationId,
			);
			if (!deleted) {
				throw app.httpErrors.notFound('Notification not found');
			}
			return reply.code(204).send(null);
		},
	);
};

import {
	type AccountId,
	type InviteId,
	inviteMemberSchema,
	type UserId,
	updateMemberRoleSchema,
} from '@rivus/core';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
	errorResponseSchema,
	inviteResponseSchema,
	memberListResponseSchema,
	memberResponseSchema,
} from '../http-schemas';
import { toInvite, toInviteSummary, toMember } from '../presenters';
import { buildInviteAcceptUrl } from '../services/email';
import { createInviteToken } from '../services/invites';

const userIdParamsSchema = z.object({ userId: z.string().min(1) });
const inviteIdParamsSchema = z.object({ inviteId: z.string().min(1) });

export const memberRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();
	const { users, accounts, memberships, invites, mailer, config } = app.deps;

	app.get(
		'/',
		{
			onRequest: [fastify.authenticate],
			schema: {
				tags: ['members'],
				summary: 'List members and pending invites for your account',
				security: [{ bearerAuth: [] }],
				response: { 200: memberListResponseSchema, 401: errorResponseSchema },
			},
		},
		async (request) => {
			const accountId = request.user.accountId as AccountId;
			const roster = await memberships.listByAccount(accountId);
			// Fetch all members' users in one query to avoid an N+1.
			const userList = await users.findByIds(roster.map((membership) => membership.userId));
			const userById = new Map(userList.map((user) => [user.id, user]));
			const members = [];
			for (const membership of roster) {
				const user = userById.get(membership.userId);
				if (user) {
					members.push(toMember(user, membership));
				}
			}
			const pending = await invites.listPendingByAccount(accountId);
			return { members, invites: pending.map(toInviteSummary) };
		},
	);

	app.post(
		'/invites',
		{
			onRequest: [fastify.authenticate, fastify.requireRole('owner', 'manager')],
			schema: {
				tags: ['members'],
				summary: 'Invite a teammate (Owner, Manager, or Member) to your account',
				security: [{ bearerAuth: [] }],
				body: inviteMemberSchema,
				response: {
					201: inviteResponseSchema,
					401: errorResponseSchema,
					403: errorResponseSchema,
					409: errorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const accountId = request.user.accountId as AccountId;
			const { email, name, role } = request.body;
			// Owners may invite any role; managers may only bring in Members (never
			// other Managers or Owners — that would be a privilege escalation).
			if (request.user.role === 'manager' && role !== 'member') {
				throw app.httpErrors.forbidden('Managers can only invite Members');
			}
			if (await users.findByEmail(email)) {
				throw app.httpErrors.conflict('A user with this email already exists');
			}
			const invite = await invites.create({
				accountId,
				email,
				name,
				role,
				token: createInviteToken(),
				invitedBy: request.user.sub as UserId,
			});

			// Deliver the invitation email. The invite is already persisted (and its
			// token is returned below), so a delivery failure must not fail the
			// request — log it and let the inviter re-send.
			try {
				const [account, inviter] = await Promise.all([
					accounts.findById(accountId),
					users.findById(request.user.sub as UserId),
				]);
				await mailer.sendInviteEmail({
					to: invite.email,
					inviteeName: invite.name,
					inviterName: inviter?.name ?? 'A teammate',
					accountName: account?.name ?? 'your team',
					role: invite.role,
					acceptUrl: buildInviteAcceptUrl(config.APP_URL, invite.token),
				});
			} catch (error) {
				request.log.error({ err: error, inviteId: invite.id }, 'failed to send invitation email');
			}

			return reply.code(201).send(toInvite(invite));
		},
	);

	app.delete(
		'/invites/:inviteId',
		{
			onRequest: [fastify.authenticate, fastify.requireRole('owner', 'manager')],
			schema: {
				tags: ['members'],
				summary: 'Revoke a pending invite',
				security: [{ bearerAuth: [] }],
				params: inviteIdParamsSchema,
				response: {
					204: z.null(),
					401: errorResponseSchema,
					403: errorResponseSchema,
					404: errorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const accountId = request.user.accountId as AccountId;
			const inviteId = request.params.inviteId as InviteId;
			const invite = await invites.findById(inviteId);
			if (!invite || invite.accountId !== accountId) {
				throw app.httpErrors.notFound('Invite not found');
			}
			// A Manager manages only Members, so can't revoke a Manager or Owner invite.
			if (request.user.role === 'manager' && invite.role !== 'member') {
				throw app.httpErrors.forbidden('Managers can only revoke Member invites');
			}
			const revoked = await invites.revoke(accountId, inviteId);
			if (!revoked) {
				throw app.httpErrors.notFound('Invite not found');
			}
			return reply.code(204).send(null);
		},
	);

	app.patch(
		'/:userId/role',
		{
			onRequest: [fastify.authenticate, fastify.requireRole('owner')],
			schema: {
				tags: ['members'],
				summary: "Change a member's role (owner only)",
				security: [{ bearerAuth: [] }],
				params: userIdParamsSchema,
				body: updateMemberRoleSchema,
				response: {
					200: memberResponseSchema,
					401: errorResponseSchema,
					403: errorResponseSchema,
					404: errorResponseSchema,
					409: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const accountId = request.user.accountId as AccountId;
			const targetUserId = request.params.userId as UserId;
			const { role } = request.body;
			const target = await memberships.findByAccountAndUser(accountId, targetUserId);
			if (!target) {
				throw app.httpErrors.notFound('Member not found');
			}
			// `updateRole` atomically refuses to demote the last owner (409 via
			// LastOwnerError), so the check and the write can't race.
			const updated = await memberships.updateRole(accountId, targetUserId, role);
			const user = await users.findById(targetUserId);
			if (!updated || !user) {
				throw app.httpErrors.notFound('Member not found');
			}
			return toMember(user, updated);
		},
	);

	app.delete(
		'/:userId',
		{
			onRequest: [fastify.authenticate, fastify.requireRole('owner', 'manager')],
			schema: {
				tags: ['members'],
				summary: 'Remove a member from your account',
				security: [{ bearerAuth: [] }],
				params: userIdParamsSchema,
				response: {
					204: z.null(),
					401: errorResponseSchema,
					403: errorResponseSchema,
					404: errorResponseSchema,
					409: errorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const accountId = request.user.accountId as AccountId;
			const targetUserId = request.params.userId as UserId;
			const target = await memberships.findByAccountAndUser(accountId, targetUserId);
			if (!target) {
				throw app.httpErrors.notFound('Member not found');
			}
			if (request.user.role === 'manager' && target.role !== 'member') {
				throw app.httpErrors.forbidden('Managers can only remove Members');
			}
			// `delete` atomically refuses to remove the last owner (409 via
			// LastOwnerError), so the check and the write can't race.
			await memberships.delete(accountId, targetUserId);
			return reply.code(204).send(null);
		},
	);
};

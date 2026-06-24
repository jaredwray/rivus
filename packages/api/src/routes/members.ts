import {
	type AccountId,
	type InviteId,
	inviteMemberSchema,
	type Role,
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
import { toInvite, toMember } from '../presenters';
import { createInviteToken } from '../services/invites';

const userIdParamsSchema = z.object({ userId: z.string().min(1) });
const inviteIdParamsSchema = z.object({ inviteId: z.string().min(1) });

/** Count the owners of an account (used to guard against orphaning it). */
async function ownerCount(
	memberships: { listByAccount(id: AccountId): Promise<{ role: Role }[]> },
	accountId: AccountId,
): Promise<number> {
	const all = await memberships.listByAccount(accountId);
	return all.filter((m) => m.role === 'owner').length;
}

export const memberRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();
	const { users, memberships, invites } = app.deps;

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
			const members = [];
			for (const membership of roster) {
				const user = await users.findById(membership.userId);
				if (user) {
					members.push(toMember(user, membership));
				}
			}
			const pending = await invites.listPendingByAccount(accountId);
			return { members, invites: pending.map(toInvite) };
		},
	);

	app.post(
		'/invites',
		{
			onRequest: [fastify.authenticate, fastify.requireRole('owner', 'manager')],
			schema: {
				tags: ['members'],
				summary: 'Invite a Manager or Team Member to your account',
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
			// Managers may only bring in Team Members, never other Managers.
			if (request.user.role === 'manager' && role !== 'team_member') {
				throw app.httpErrors.forbidden('Managers can only invite Team Members');
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
			const revoked = await invites.revoke(accountId, request.params.inviteId as InviteId);
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
			// Don't let the final owner be demoted out of ownership.
			if (
				target.role === 'owner' &&
				role !== 'owner' &&
				(await ownerCount(memberships, accountId)) <= 1
			) {
				throw app.httpErrors.conflict('Cannot change the role of the last owner');
			}
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
			if (request.user.role === 'manager' && target.role !== 'team_member') {
				throw app.httpErrors.forbidden('Managers can only remove Team Members');
			}
			if (target.role === 'owner' && (await ownerCount(memberships, accountId)) <= 1) {
				throw app.httpErrors.conflict('Cannot remove the last owner');
			}
			await memberships.delete(accountId, targetUserId);
			return reply.code(204).send(null);
		},
	);
};

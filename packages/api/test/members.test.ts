import { gravatarUrl, type Role } from '@rivus/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, RecordingMailer, signupOwner } from './helpers';

describe('members', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		app = await buildTestApp();
	});

	afterEach(async () => {
		await app.close();
	});

	function inviteMember(token: string, role: Role, email: string) {
		return app.inject({
			method: 'POST',
			url: '/v1/members/invites',
			headers: authHeader(token),
			payload: { email, name: 'Member', role },
		});
	}

	/** Invite + accept, returning the new member's session token and user id. */
	async function addMember(ownerToken: string, role: Role, email: string) {
		const inviteToken = (await inviteMember(ownerToken, role, email)).json().token;
		const accepted = await app.inject({
			method: 'POST',
			url: '/v1/auth/accept-invite',
			payload: { token: inviteToken },
		});
		const body = accepted.json();
		return { token: body.token as string, userId: body.user.id as string };
	}

	it('requires authentication to list members', async () => {
		const response = await app.inject({ method: 'GET', url: '/v1/members' });
		expect(response.statusCode).toBe(401);
	});

	it('lists the founding owner as the sole member', async () => {
		const owner = await signupOwner(app);
		const response = await app.inject({
			method: 'GET',
			url: '/v1/members',
			headers: authHeader(owner.token),
		});

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.members).toHaveLength(1);
		expect(body.members[0]).toMatchObject({ userId: owner.user.id, role: 'owner' });
		expect(body.invites).toEqual([]);
	});

	it("defaults a member's roster avatar to their Gravatar", async () => {
		const owner = await signupOwner(app);
		const response = await app.inject({
			method: 'GET',
			url: '/v1/members',
			headers: authHeader(owner.token),
		});

		expect(response.json().members[0].avatarUrl).toBe(gravatarUrl(owner.credentials.email));
	});

	it("reflects a member's custom avatar in the roster", async () => {
		const owner = await signupOwner(app);
		const teammate = await addMember(owner.token, 'member', 'teammate@example.com');
		await app.inject({
			method: 'PATCH',
			url: '/v1/auth/me',
			headers: authHeader(teammate.token),
			payload: { avatarUrl: 'https://example.com/teammate.jpg' },
		});

		const response = await app.inject({
			method: 'GET',
			url: '/v1/members',
			headers: authHeader(owner.token),
		});

		const member = response
			.json()
			.members.find((m: { userId: string }) => m.userId === teammate.userId);
		expect(member.avatarUrl).toBe('https://example.com/teammate.jpg');
	});

	it('lets an owner invite a manager and shows the pending invite', async () => {
		const owner = await signupOwner(app);
		const invite = await inviteMember(owner.token, 'manager', 'manager@example.com');
		expect(invite.statusCode).toBe(201);
		expect(invite.json()).toMatchObject({ email: 'manager@example.com', role: 'manager' });
		// The creator gets the shareable token...
		expect(invite.json().token).toBeTypeOf('string');

		const list = await app.inject({
			method: 'GET',
			url: '/v1/members',
			headers: authHeader(owner.token),
		});
		expect(list.json().invites).toHaveLength(1);
		// ...but the roster never leaks invite tokens (any member can read it).
		expect(list.json().invites[0]).not.toHaveProperty('token');
	});

	it('hides invite tokens from a Member listing the roster', async () => {
		const owner = await signupOwner(app);
		await inviteMember(owner.token, 'manager', 'manager@example.com');
		const teamMember = await addMember(owner.token, 'member', 'tm@example.com');

		const list = await app.inject({
			method: 'GET',
			url: '/v1/members',
			headers: authHeader(teamMember.token),
		});
		expect(list.statusCode).toBe(200);
		for (const invite of list.json().invites) {
			expect(invite).not.toHaveProperty('token');
		}
	});

	it('lets an owner revoke a pending invite', async () => {
		const owner = await signupOwner(app);
		const inviteId = (await inviteMember(owner.token, 'manager', 'revoke@example.com')).json().id;

		const response = await app.inject({
			method: 'DELETE',
			url: `/v1/members/invites/${inviteId}`,
			headers: authHeader(owner.token),
		});
		expect(response.statusCode).toBe(204);

		const list = await app.inject({
			method: 'GET',
			url: '/v1/members',
			headers: authHeader(owner.token),
		});
		expect(list.json().invites).toEqual([]);
	});

	it('lets a Manager revoke a Member invite but not a Manager invite', async () => {
		const owner = await signupOwner(app);
		const manager = await addMember(owner.token, 'manager', 'mgr@example.com');
		const tmInviteId = (await inviteMember(owner.token, 'member', 'tm@example.com')).json().id;
		const mgrInviteId = (await inviteMember(owner.token, 'manager', 'mgr2@example.com')).json().id;

		const revokeManager = await app.inject({
			method: 'DELETE',
			url: `/v1/members/invites/${mgrInviteId}`,
			headers: authHeader(manager.token),
		});
		expect(revokeManager.statusCode).toBe(403);

		const revokeTeamMember = await app.inject({
			method: 'DELETE',
			url: `/v1/members/invites/${tmInviteId}`,
			headers: authHeader(manager.token),
		});
		expect(revokeTeamMember.statusCode).toBe(204);
	});

	it('returns 404 revoking an already-revoked invite', async () => {
		const owner = await signupOwner(app);
		const inviteId = (await inviteMember(owner.token, 'manager', 'gone@example.com')).json().id;
		await app.inject({
			method: 'DELETE',
			url: `/v1/members/invites/${inviteId}`,
			headers: authHeader(owner.token),
		});

		const again = await app.inject({
			method: 'DELETE',
			url: `/v1/members/invites/${inviteId}`,
			headers: authHeader(owner.token),
		});
		expect(again.statusCode).toBe(404);
	});

	it('returns 404 revoking an unknown invite', async () => {
		const owner = await signupOwner(app);
		const response = await app.inject({
			method: 'DELETE',
			url: '/v1/members/invites/nonexistent',
			headers: authHeader(owner.token),
		});
		expect(response.statusCode).toBe(404);
	});

	it('rejects inviting an email that already has a user (409)', async () => {
		const owner = await signupOwner(app);
		await addMember(owner.token, 'member', 'dupe@example.com');

		const again = await inviteMember(owner.token, 'member', 'dupe@example.com');
		expect(again.statusCode).toBe(409);
	});

	it('lets a manager invite a Member but not another Manager or an Owner', async () => {
		const owner = await signupOwner(app);
		const manager = await addMember(owner.token, 'manager', 'mgr@example.com');

		const member = await inviteMember(manager.token, 'member', 'tm@example.com');
		expect(member.statusCode).toBe(201);

		const anotherManager = await inviteMember(manager.token, 'manager', 'mgr2@example.com');
		expect(anotherManager.statusCode).toBe(403);

		const newOwner = await inviteMember(manager.token, 'owner', 'owner2@example.com');
		expect(newOwner.statusCode).toBe(403);
	});

	it('lets an owner invite another owner, who joins as an owner', async () => {
		const owner = await signupOwner(app);
		const invite = await inviteMember(owner.token, 'owner', 'coowner@example.com');
		expect(invite.statusCode).toBe(201);
		expect(invite.json()).toMatchObject({ email: 'coowner@example.com', role: 'owner' });

		const second = await addMember(owner.token, 'owner', 'coowner2@example.com');
		const me = await app.inject({
			method: 'GET',
			url: '/v1/auth/me',
			headers: authHeader(second.token),
		});
		expect(me.json().role).toBe('owner');
	});

	it('forbids a Member from inviting anyone (403)', async () => {
		const owner = await signupOwner(app);
		const member = await addMember(owner.token, 'member', 'tm@example.com');

		const response = await inviteMember(member.token, 'member', 'another@example.com');
		expect(response.statusCode).toBe(403);
	});

	it('lets an owner change a member’s role', async () => {
		const owner = await signupOwner(app);
		const member = await addMember(owner.token, 'member', 'promote@example.com');

		const response = await app.inject({
			method: 'PATCH',
			url: `/v1/members/${member.userId}/role`,
			headers: authHeader(owner.token),
			payload: { role: 'manager' },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({ userId: member.userId, role: 'manager' });
	});

	it('forbids a manager from changing roles (403)', async () => {
		const owner = await signupOwner(app);
		const manager = await addMember(owner.token, 'manager', 'mgr@example.com');
		const teamMember = await addMember(owner.token, 'member', 'tm@example.com');

		const response = await app.inject({
			method: 'PATCH',
			url: `/v1/members/${teamMember.userId}/role`,
			headers: authHeader(manager.token),
			payload: { role: 'manager' },
		});
		expect(response.statusCode).toBe(403);
	});

	it('returns 404 changing the role of a non-member', async () => {
		const owner = await signupOwner(app);
		const response = await app.inject({
			method: 'PATCH',
			url: '/v1/members/nonexistent/role',
			headers: authHeader(owner.token),
			payload: { role: 'manager' },
		});
		expect(response.statusCode).toBe(404);
	});

	it('refuses to demote the last owner (409)', async () => {
		const owner = await signupOwner(app);
		const response = await app.inject({
			method: 'PATCH',
			url: `/v1/members/${owner.user.id}/role`,
			headers: authHeader(owner.token),
			payload: { role: 'member' },
		});
		expect(response.statusCode).toBe(409);
	});

	it('allows demoting an owner once a second owner exists', async () => {
		const owner = await signupOwner(app);
		const member = await addMember(owner.token, 'manager', 'coowner@example.com');

		const promote = await app.inject({
			method: 'PATCH',
			url: `/v1/members/${member.userId}/role`,
			headers: authHeader(owner.token),
			payload: { role: 'owner' },
		});
		expect(promote.statusCode).toBe(200);

		const demote = await app.inject({
			method: 'PATCH',
			url: `/v1/members/${owner.user.id}/role`,
			headers: authHeader(owner.token),
			payload: { role: 'manager' },
		});
		expect(demote.statusCode).toBe(200);
	});

	it('lets an owner remove a member', async () => {
		const owner = await signupOwner(app);
		const member = await addMember(owner.token, 'member', 'remove@example.com');

		const response = await app.inject({
			method: 'DELETE',
			url: `/v1/members/${member.userId}`,
			headers: authHeader(owner.token),
		});
		expect(response.statusCode).toBe(204);

		const list = await app.inject({
			method: 'GET',
			url: '/v1/members',
			headers: authHeader(owner.token),
		});
		expect(list.json().members).toHaveLength(1);
	});

	it('lets a manager remove a Member but not a Manager', async () => {
		const owner = await signupOwner(app);
		const manager = await addMember(owner.token, 'manager', 'mgr@example.com');
		const otherManager = await addMember(owner.token, 'manager', 'mgr2@example.com');
		const teamMember = await addMember(owner.token, 'member', 'tm@example.com');

		const removeManager = await app.inject({
			method: 'DELETE',
			url: `/v1/members/${otherManager.userId}`,
			headers: authHeader(manager.token),
		});
		expect(removeManager.statusCode).toBe(403);

		const removeTeamMember = await app.inject({
			method: 'DELETE',
			url: `/v1/members/${teamMember.userId}`,
			headers: authHeader(manager.token),
		});
		expect(removeTeamMember.statusCode).toBe(204);
	});

	it('refuses to remove the last owner (409)', async () => {
		const owner = await signupOwner(app);
		const response = await app.inject({
			method: 'DELETE',
			url: `/v1/members/${owner.user.id}`,
			headers: authHeader(owner.token),
		});
		expect(response.statusCode).toBe(409);
	});

	it('allows removing an owner once a second owner exists', async () => {
		const owner = await signupOwner(app);
		const coOwner = await addMember(owner.token, 'owner', 'coowner@example.com');

		const response = await app.inject({
			method: 'DELETE',
			url: `/v1/members/${coOwner.userId}`,
			headers: authHeader(owner.token),
		});
		expect(response.statusCode).toBe(204);
	});

	it('returns 404 removing a non-member', async () => {
		const owner = await signupOwner(app);
		const response = await app.inject({
			method: 'DELETE',
			url: '/v1/members/nonexistent',
			headers: authHeader(owner.token),
		});
		expect(response.statusCode).toBe(404);
	});

	it('rejects a removed member’s existing token (membership revalidated per request)', async () => {
		const owner = await signupOwner(app);
		const member = await addMember(owner.token, 'member', 'removed@example.com');
		await app.inject({
			method: 'DELETE',
			url: `/v1/members/${member.userId}`,
			headers: authHeader(owner.token),
		});

		// The member's token is still cryptographically valid, but their membership
		// is gone — the guard must reject it rather than trust the stale claim.
		const response = await app.inject({
			method: 'GET',
			url: '/v1/auth/me',
			headers: authHeader(member.token),
		});
		expect(response.statusCode).toBe(401);
	});

	it('reflects a role change on the next request (demoted manager loses invite rights)', async () => {
		const owner = await signupOwner(app);
		const manager = await addMember(owner.token, 'manager', 'demote@example.com');

		const before = await inviteMember(manager.token, 'member', 'before@example.com');
		expect(before.statusCode).toBe(201);

		await app.inject({
			method: 'PATCH',
			url: `/v1/members/${manager.userId}/role`,
			headers: authHeader(owner.token),
			payload: { role: 'member' },
		});

		// Same (now-stale) manager token — the guard refreshes the role from the DB.
		const after = await inviteMember(manager.token, 'member', 'after@example.com');
		expect(after.statusCode).toBe(403);
	});

	it('shares items across all members of the same account', async () => {
		const owner = await signupOwner(app);
		const created = await app.inject({
			method: 'POST',
			url: '/v1/items',
			headers: authHeader(owner.token),
			payload: { name: 'Shared job' },
		});
		const itemId = created.json().id;

		const member = await addMember(owner.token, 'member', 'teammate@example.com');
		const response = await app.inject({
			method: 'GET',
			url: `/v1/items/${itemId}`,
			headers: authHeader(member.token),
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().id).toBe(itemId);
	});
});

describe('member invitations send email', () => {
	it('sends an invitation email with the account, inviter, role and accept link', async () => {
		const mailer = new RecordingMailer();
		const app = await buildTestApp({ mailer });
		try {
			const owner = await signupOwner(app, { businessName: 'Acme Co', name: 'Olive Owner' });
			const response = await app.inject({
				method: 'POST',
				url: '/v1/members/invites',
				headers: authHeader(owner.token),
				payload: { email: 'newhire@example.com', name: 'New Hire', role: 'manager' },
			});
			expect(response.statusCode).toBe(201);
			const token = response.json().token;

			expect(mailer.invites).toHaveLength(1);
			expect(mailer.invites[0]).toEqual({
				to: 'newhire@example.com',
				inviteeName: 'New Hire',
				inviterName: 'Olive Owner',
				accountName: 'Acme Co',
				role: 'manager',
				acceptUrl: `https://app.rivus.ai/accept-invite?token=${token}`,
			});
		} finally {
			await app.close();
		}
	});

	it('still creates the invite when email delivery fails', async () => {
		// Records verification codes (so signupOwner still works) but fails to deliver
		// the invitation email.
		class FailingInviteMailer extends RecordingMailer {
			override async sendInviteEmail(): Promise<void> {
				throw new Error('resend is down');
			}
		}
		const app = await buildTestApp({ mailer: new FailingInviteMailer() });
		try {
			const owner = await signupOwner(app);
			const response = await app.inject({
				method: 'POST',
				url: '/v1/members/invites',
				headers: authHeader(owner.token),
				payload: { email: 'newhire@example.com', name: 'New Hire', role: 'member' },
			});

			// Delivery failed, but the invite is persisted and its token returned.
			expect(response.statusCode).toBe(201);
			expect(response.json().token).toBeTypeOf('string');
		} finally {
			await app.close();
		}
	});
});

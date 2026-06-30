import type { Account, Invite, Membership, User } from '@rivus/core';
import type { StoredUser } from './repositories/types';

/** Strip the password hash before a user ever leaves the API. */
export function toPublicUser(user: StoredUser): User {
	return {
		id: user.id,
		email: user.email,
		name: user.name,
		phone: user.phone,
		pendingEmail: user.pendingEmail,
		createdAt: user.createdAt,
		updatedAt: user.updatedAt,
	};
}

/** Accounts carry no secrets; this just pins the serialized shape. */
export function toPublicAccount(account: Account): Account {
	return {
		id: account.id,
		name: account.name,
		slug: account.slug,
		phone: account.phone,
		address: account.address,
		website: account.website,
		timezone: account.timezone,
		status: account.status,
		canceledAt: account.canceledAt,
		createdAt: account.createdAt,
		updatedAt: account.updatedAt,
	};
}

/** Combine a user with their membership into the member projection. */
export function toMember(user: StoredUser, membership: Membership) {
	return {
		userId: user.id,
		email: user.email,
		name: user.name,
		role: membership.role,
		joinedAt: membership.createdAt,
	};
}

/** Roster view of an invite — never includes the bearer token. */
export function toInviteSummary(invite: Invite) {
	return {
		id: invite.id,
		email: invite.email,
		name: invite.name,
		role: invite.role,
		status: invite.status,
		createdAt: invite.createdAt,
	};
}

/** Creator view of an invite — includes the shareable token. */
export function toInvite(invite: Invite) {
	return { ...toInviteSummary(invite), token: invite.token };
}

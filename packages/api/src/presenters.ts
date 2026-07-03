import {
	type Account,
	gravatarUrl,
	type Invite,
	type Membership,
	type ProvisionedChannel,
	type User,
} from '@rivus/core';
import type { StoredUser } from './repositories/types';

/** A provisioned channel's config as exposed to clients — the provider reference stays server-side. */
export interface PublicAccountChannelConfig {
	enabled: boolean;
	address: string;
}

/**
 * An account as returned by the API: like {@link Account}, but each channel
 * config drops `providerRef` (a provider-internal handle clients never need).
 */
export type PublicAccount = Omit<Account, 'channels'> & {
	channels: Record<ProvisionedChannel, PublicAccountChannelConfig>;
};

/** The user's custom avatar override, or their Gravatar if none is set. */
function resolveAvatarUrl(user: StoredUser): string {
	return user.avatarUrl || gravatarUrl(user.email);
}

/** Strip the password hash before a user ever leaves the API. */
export function toPublicUser(user: StoredUser): User {
	return {
		id: user.id,
		email: user.email,
		name: user.name,
		phone: user.phone,
		pendingEmail: user.pendingEmail,
		avatarUrl: resolveAvatarUrl(user),
		createdAt: user.createdAt,
		updatedAt: user.updatedAt,
	};
}

/** One stored channel config → its public shape (drops `providerRef`). */
function toPublicChannel(config: Account['channels']['whatsapp']): PublicAccountChannelConfig {
	return { enabled: config.enabled, address: config.address };
}

/** Pins the serialized account shape; channel configs expose only `enabled`/`address`. */
export function toPublicAccount(account: Account): PublicAccount {
	return {
		id: account.id,
		name: account.name,
		slug: account.slug,
		phone: account.phone,
		address: account.address,
		website: account.website,
		timezone: account.timezone,
		channels: {
			whatsapp: toPublicChannel(account.channels.whatsapp),
			sms: toPublicChannel(account.channels.sms),
			voice: toPublicChannel(account.channels.voice),
		},
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
		avatarUrl: resolveAvatarUrl(user),
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

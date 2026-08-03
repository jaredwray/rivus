import type { Customer, TesterChannel, TesterSession } from '@/src/api/client';
import { colors } from '@/src/theme/tokens';

/**
 * Shared display metadata for the staff-only Agent Tester, used by both the
 * screen and its new-session modal so a channel or agent state reads the same
 * everywhere.
 */

/** The channels a tester session can run on, in the order the picker offers them. */
export const TESTER_CHANNELS: TesterChannel[] = ['email', 'sms', 'whatsapp', 'phone'];

/**
 * Label and dot color per channel — the same language the Inbox uses for its
 * channel dots, so a channel looks identical on both screens.
 */
export const CHANNEL_META: Record<TesterChannel, { label: string; color: string }> = {
	email: { label: 'Email', color: colors.brandPurple },
	sms: { label: 'SMS', color: colors.textMuted },
	whatsapp: { label: 'WhatsApp', color: colors.green },
	phone: { label: 'Phone', color: colors.brandCyan },
};

/**
 * StatusBadge tones for where the agent's scheduling state machine stands:
 * neutral while it's new, warning while it waits on a signup, the accent violet
 * once times are on the table, and success once a job is booked.
 */
export const STATE_META: Record<
	TesterSession['state'],
	{ label: string; color: string; bg: string }
> = {
	new: { label: 'New', color: colors.textSub, bg: colors.chipBg },
	awaiting_signup: {
		label: 'Awaiting signup',
		color: colors.amberInk,
		bg: 'rgba(240,160,32,0.16)',
	},
	slots_offered: { label: 'Slots offered', color: colors.brandPurple, bg: colors.purpleTint },
	booked: { label: 'Booked', color: colors.green, bg: 'rgba(31,181,115,0.12)' },
};

/** Placeholder for the custom-contact address field — an address the channel uses. */
export function addressPlaceholder(channel: TesterChannel): string {
	return channel === 'email' ? 'customer@example.com' : '+1 555 123 4567';
}

/** The address the agent would reach a customer on for a given channel. */
export function addressFor(customer: Customer, channel: TesterChannel): string {
	return channel === 'email' ? customer.email : customer.phone;
}

/**
 * Why a customer can't be impersonated on this channel — empty when they can.
 * SMS, WhatsApp and calls all ride on the phone number.
 */
export function missingAddressHint(customer: Customer, channel: TesterChannel): string {
	if (addressFor(customer, channel)) {
		return '';
	}
	return channel === 'email' ? 'No email on file' : 'No phone on file';
}

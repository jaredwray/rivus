import type { SignupPrefill } from './channel';

/**
 * The self-signup link the agent hands an unrecognized contact, on any channel.
 * Points at the website's public "join as a customer" view for the account, with
 * the contact's address prefilled so the form recognizes them the moment they
 * submit. The prefill is channel-shaped: email channels prefill `?email=`, phone
 * channels (WhatsApp/SMS) prefill `?phone=`. A bare string is accepted as the
 * email form for callers (and tests) that predate the multi-channel prefill.
 */
export function buildCustomerSignupUrl(
	websiteUrl: string,
	slug: string,
	prefill: string | SignupPrefill,
): string {
	const base = websiteUrl.replace(/\/+$/, '');
	const { param, value } =
		typeof prefill === 'string' ? { param: 'email' as const, value: prefill } : prefill;
	return `${base}/customers/join/${encodeURIComponent(slug)}?${param}=${encodeURIComponent(value)}`;
}

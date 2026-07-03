/**
 * The self-signup link the agent hands an unrecognized contact, on any
 * channel. Points at the website's public "join as a customer" view for the
 * account, with the contact's address prefilled so the form recognizes them
 * the moment they submit.
 */
export function buildCustomerSignupUrl(websiteUrl: string, slug: string, email: string): string {
	const base = websiteUrl.replace(/\/+$/, '');
	return `${base}/customers/join/${encodeURIComponent(slug)}?email=${encodeURIComponent(email)}`;
}

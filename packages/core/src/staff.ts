/**
 * The email domain whose users are Rivus staff. Staff are trusted operators
 * (support / admin) who can list every company and switch the active company —
 * unlike a regular customer, who only ever belongs to their own single account.
 */
export const RIVUS_STAFF_DOMAIN = 'rivus.ai';

/**
 * Whether an email address belongs to Rivus staff (its domain is exactly
 * {@link RIVUS_STAFF_DOMAIN}).
 *
 * The check is anchored on the last `@` and matches the domain exactly, so a
 * lookalike like `evil@notrivus.ai`, a subdomain like `x@mail.rivus.ai`, or a
 * suffix trick like `x@rivus.ai.attacker.com` are all rejected. Comparison is
 * case-insensitive and tolerant of surrounding whitespace.
 *
 * @example isRivusStaffEmail('ops@rivus.ai') // true
 * @example isRivusStaffEmail('jane@acme.com') // false
 */
export function isRivusStaffEmail(email: string): boolean {
	const at = email.lastIndexOf('@');
	if (at === -1) {
		return false;
	}
	return (
		email
			.slice(at + 1)
			.trim()
			.toLowerCase() === RIVUS_STAFF_DOMAIN
	);
}

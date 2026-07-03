/**
 * Phone-number canonicalization shared by every phone-shaped channel (WhatsApp,
 * SMS, voice). The CRM stores customer phones as free text ("(555) 123-4567"),
 * while messaging providers deliver senders in E.164 ("+15551234567"), so a
 * match has to normalize both sides to the same canonical form. Kept
 * dependency-free on purpose: a full libphonenumber would never clear the 7-day
 * supply-chain gate and is far more than a small business's US-centric CRM
 * needs. The rules are deliberately conservative — an ambiguous number returns
 * `''` (no match) rather than guessing a country and mislinking two people.
 */

/** The E.164 minimum/maximum significant-digit counts (country code + subscriber). */
const E164_MIN_DIGITS = 8;
const E164_MAX_DIGITS = 15;

/**
 * Canonicalize a free-text phone number to E.164 (`+` followed by 8–15 digits),
 * or `''` when it can't be done confidently. Rules:
 *
 * - A value that already starts with `+` keeps its digits when there are 8–15 of
 *   them (separators, spaces, and parentheses are stripped): `+44 20 7946 0958`
 *   → `+442079460958`.
 * - 11 bare digits beginning with `1` are treated as North American: `15551234567`
 *   → `+15551234567`.
 * - 10 bare digits are assumed to be in `defaultCountry` (only `US` today), so
 *   `(555) 123-4567` → `+15551234567`.
 * - Anything else (too short, too long, a non-US bare international number) → `''`.
 *
 * @example normalizePhone('(555) 123-4567') // '+15551234567'
 * @example normalizePhone('+44 20 7946 0958') // '+442079460958'
 * @example normalizePhone('nope') // ''
 */
export function normalizePhone(raw: string, options?: { defaultCountry?: 'US' }): string {
	const trimmed = raw.trim();
	const hasPlus = trimmed.startsWith('+');
	// `\D` drops the leading `+` too, leaving only the significant digits.
	const digits = trimmed.replace(/\D/g, '');

	if (hasPlus) {
		return digits.length >= E164_MIN_DIGITS && digits.length <= E164_MAX_DIGITS ? `+${digits}` : '';
	}
	if (digits.length === 11 && digits.startsWith('1')) {
		return `+${digits}`;
	}
	// The option type only admits `US`, so a 10-digit bare number is always +1.
	if (digits.length === 10 && (options?.defaultCountry ?? 'US') === 'US') {
		return `+1${digits}`;
	}
	return '';
}

/**
 * Whether two free-text phone numbers denote the same line — true only when both
 * normalize to a non-empty E.164 and those forms are equal. Two unnormalizable
 * (or empty) numbers never match, so a customer with no phone on file is never
 * mistaken for an inbound sender.
 */
export function phonesMatch(a: string, b: string): boolean {
	const left = normalizePhone(a);
	return left !== '' && left === normalizePhone(b);
}

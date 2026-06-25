import { randomInt } from 'node:crypto';

/** One-time codes are valid for 10 minutes after they're issued. */
export const CODE_TTL_MS = 10 * 60 * 1000;

/** Wrong-code attempts allowed before a code is burned and must be re-requested. */
export const MAX_VERIFICATION_ATTEMPTS = 5;

/**
 * Generate a zero-padded 6-digit numeric code. `randomInt` draws from a CSPRNG,
 * so codes aren't predictable; zero-padding keeps every code exactly six digits
 * (e.g. `000042`).
 */
export function generateVerificationCode(): string {
	return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** The ISO-8601 instant a code issued now should expire. */
export function codeExpiry(from: number = Date.now()): string {
	return new Date(from + CODE_TTL_MS).toISOString();
}

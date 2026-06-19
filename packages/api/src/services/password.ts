import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

export function hashPassword(plain: string): Promise<string> {
	return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
	return bcrypt.compare(plain, hash);
}

let cachedDummyHash: Promise<string> | undefined;

/**
 * A throwaway hash to compare against when an account is not found, so login
 * timing does not reveal whether an email exists. Computed once, lazily.
 */
export function dummyPasswordHash(): Promise<string> {
	cachedDummyHash ??= hashPassword('rivus-timing-equalizer');
	return cachedDummyHash;
}

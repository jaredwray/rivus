import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

/**
 * Hash a password with Node's native scrypt. Unlike a pure-JS bcrypt, scrypt
 * runs on libuv's threadpool, so it does not block the event loop under load.
 * The salt is stored alongside the derived key as `salt:key` (both hex).
 */
export async function hashPassword(plain: string): Promise<string> {
	const salt = randomBytes(16).toString('hex');
	const derivedKey = (await scryptAsync(plain, salt, KEY_LENGTH)) as Buffer;
	return `${salt}:${derivedKey.toString('hex')}`;
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
	const [salt, key] = hash.split(':');
	if (!salt || !key) {
		return false;
	}
	const keyBuffer = Buffer.from(key, 'hex');
	const derivedKey = (await scryptAsync(plain, salt, KEY_LENGTH)) as Buffer;
	if (keyBuffer.length !== derivedKey.length) {
		return false;
	}
	return timingSafeEqual(keyBuffer, derivedKey);
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

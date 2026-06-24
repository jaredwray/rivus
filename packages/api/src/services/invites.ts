import { randomBytes } from 'node:crypto';

/** Generate an opaque, URL-safe invitation token. */
export function createInviteToken(): string {
	return randomBytes(24).toString('hex');
}

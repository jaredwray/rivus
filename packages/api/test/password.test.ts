import { describe, expect, it } from 'vitest';
import { dummyPasswordHash, hashPassword, verifyPassword } from '../src/services/password';

describe('password hashing', () => {
	it('round-trips a password', async () => {
		const hash = await hashPassword('supersecret123');
		expect(hash).toContain(':');
		expect(await verifyPassword('supersecret123', hash)).toBe(true);
	});

	it('rejects a wrong password', async () => {
		const hash = await hashPassword('supersecret123');
		expect(await verifyPassword('not-it', hash)).toBe(false);
	});

	it('rejects a malformed hash with no delimiter', async () => {
		expect(await verifyPassword('whatever', 'no-delimiter')).toBe(false);
	});

	it('rejects a hash whose key is the wrong length', async () => {
		expect(await verifyPassword('whatever', 'abcd:aa')).toBe(false);
	});

	it('reuses a single dummy hash for timing equalization', async () => {
		expect(await dummyPasswordHash()).toBe(await dummyPasswordHash());
	});
});

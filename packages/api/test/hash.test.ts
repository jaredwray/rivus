import { describe, expect, it } from 'vitest';
import { hashSecret, verifySecret } from '../src/services/hash';

describe('hashSecret / verifySecret', () => {
	it('verifies a secret against its own hash', async () => {
		const hash = await hashSecret('123456');
		expect(await verifySecret('123456', hash)).toBe(true);
	});

	it('rejects the wrong secret', async () => {
		const hash = await hashSecret('123456');
		expect(await verifySecret('654321', hash)).toBe(false);
	});

	it('produces a unique salt per call (same input, different hash)', async () => {
		const a = await hashSecret('123456');
		const b = await hashSecret('123456');
		expect(a).not.toBe(b);
		expect(await verifySecret('123456', a)).toBe(true);
		expect(await verifySecret('123456', b)).toBe(true);
	});

	it('returns false for a malformed hash', async () => {
		expect(await verifySecret('123456', 'not-a-valid-hash')).toBe(false);
		expect(await verifySecret('123456', '')).toBe(false);
	});
});

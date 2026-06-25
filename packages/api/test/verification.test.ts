import { describe, expect, it } from 'vitest';
import { CODE_TTL_MS, codeExpiry, generateVerificationCode } from '../src/services/verification';

describe('generateVerificationCode', () => {
	it('always returns exactly six digits', () => {
		for (let i = 0; i < 500; i++) {
			expect(generateVerificationCode()).toMatch(/^\d{6}$/);
		}
	});

	it('zero-pads small numbers to six digits', () => {
		// Over many draws we should eventually see a leading zero; assert the format
		// holds for every draw rather than relying on a specific value.
		const codes = Array.from({ length: 200 }, generateVerificationCode);
		expect(codes.every((code) => code.length === 6)).toBe(true);
	});
});

describe('codeExpiry', () => {
	it('returns an ISO timestamp CODE_TTL_MS in the future', () => {
		const from = Date.parse('2026-06-24T00:00:00.000Z');
		expect(codeExpiry(from)).toBe(new Date(from + CODE_TTL_MS).toISOString());
	});
});

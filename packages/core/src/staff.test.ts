import { describe, expect, it } from 'vitest';
import { isRivusStaffEmail, RIVUS_STAFF_DOMAIN } from './staff';

describe('isRivusStaffEmail', () => {
	it('accepts an address on the staff domain', () => {
		expect(isRivusStaffEmail('ops@rivus.ai')).toBe(true);
	});

	it('is case-insensitive and trims whitespace', () => {
		expect(isRivusStaffEmail('  Ops@Rivus.AI  ')).toBe(true);
	});

	it('rejects a regular customer address', () => {
		expect(isRivusStaffEmail('jane@acme.com')).toBe(false);
	});

	it('rejects a lookalike domain', () => {
		expect(isRivusStaffEmail('evil@notrivus.ai')).toBe(false);
	});

	it('rejects a subdomain of the staff domain', () => {
		expect(isRivusStaffEmail('x@mail.rivus.ai')).toBe(false);
	});

	it('rejects a suffix-trick domain', () => {
		expect(isRivusStaffEmail('x@rivus.ai.attacker.com')).toBe(false);
	});

	it('rejects a string with no @', () => {
		expect(isRivusStaffEmail('rivus.ai')).toBe(false);
	});

	it('exposes the staff domain constant', () => {
		expect(RIVUS_STAFF_DOMAIN).toBe('rivus.ai');
	});
});

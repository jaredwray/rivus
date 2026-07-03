import { describe, expect, it } from 'vitest';
import { normalizePhone, phonesMatch } from './phone';

describe('normalizePhone', () => {
	it('normalizes common free-text US formats to E.164', () => {
		expect(normalizePhone('(555) 123-4567')).toBe('+15551234567');
		expect(normalizePhone('555.123.4567')).toBe('+15551234567');
		expect(normalizePhone('555-123-4567')).toBe('+15551234567');
		expect(normalizePhone('5551234567')).toBe('+15551234567');
	});

	it('keeps an already-normalized number and strips separators', () => {
		expect(normalizePhone('+15551234567')).toBe('+15551234567');
		expect(normalizePhone('+1 (555) 123-4567')).toBe('+15551234567');
	});

	it('treats 11 bare digits beginning with 1 as North American', () => {
		expect(normalizePhone('15551234567')).toBe('+15551234567');
		expect(normalizePhone('1 (555) 123-4567')).toBe('+15551234567');
	});

	it('accepts a plus-prefixed international number within E.164 length', () => {
		expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
		expect(normalizePhone('+442079460958')).toBe('+442079460958');
	});

	it('returns empty string for values it cannot confidently normalize', () => {
		expect(normalizePhone('')).toBe('');
		expect(normalizePhone('   ')).toBe('');
		expect(normalizePhone('not a phone')).toBe('');
		// Too short even for a plus number (7 digits < 8).
		expect(normalizePhone('+1234567')).toBe('');
		// Bare digits that are neither 10 nor 11-with-1.
		expect(normalizePhone('12345')).toBe('');
		expect(normalizePhone('442079460958')).toBe('');
		// Longer than E.164 permits (16 digits).
		expect(normalizePhone('+1234567890123456')).toBe('');
	});

	it('is idempotent on its own output', () => {
		const once = normalizePhone('(555) 123-4567');
		expect(normalizePhone(once)).toBe(once);
	});
});

describe('phonesMatch', () => {
	it('matches two free-text forms of the same line', () => {
		expect(phonesMatch('(555) 123-4567', '+15551234567')).toBe(true);
		expect(phonesMatch('1-555-123-4567', '555.123.4567')).toBe(true);
	});

	it('does not match different numbers', () => {
		expect(phonesMatch('(555) 123-4567', '(555) 765-4321')).toBe(false);
	});

	it('never matches when either side is unnormalizable or empty', () => {
		expect(phonesMatch('', '+15551234567')).toBe(false);
		expect(phonesMatch('+15551234567', '')).toBe(false);
		expect(phonesMatch('nope', 'nope')).toBe(false);
	});
});

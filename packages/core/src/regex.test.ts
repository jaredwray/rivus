import { describe, expect, it } from 'vitest';
import { escapeRegex } from './regex';

describe('escapeRegex', () => {
	it('escapes every regex metacharacter so the term matches only itself', () => {
		// Built from a char array so the literal `${` never appears in source (which
		// would trip Biome's template-string lint); the value is the metachar set.
		const metachars = ['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\'].join(
			'',
		);
		const rx = new RegExp(escapeRegex(metachars));
		expect(rx.test(metachars)).toBe(true);
		expect(rx.test('anything else')).toBe(false);
	});

	it('treats a dotted term as literal text, not a wildcard', () => {
		const rx = new RegExp(escapeRegex('a.b'), 'i');
		expect(rx.test('a.b')).toBe(true);
		expect(rx.test('axb')).toBe(false);
	});

	it('escapes phone-style and quantifier inputs', () => {
		expect(new RegExp(escapeRegex('(206)')).test('(206)')).toBe(true);
		// `a+` must match the literal "a+", not "one or more a".
		const plus = new RegExp(escapeRegex('a+'));
		expect(plus.test('a+')).toBe(true);
		expect(plus.test('aaaa')).toBe(false);
	});

	it('leaves an ordinary term unchanged', () => {
		expect(escapeRegex('grace')).toBe('grace');
	});
});

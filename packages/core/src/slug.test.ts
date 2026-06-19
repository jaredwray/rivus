import { describe, expect, it } from 'vitest';
import { slugify } from './slug';

describe('slugify', () => {
	it('lowercases and hyphenates words', () => {
		expect(slugify('Hello World')).toBe('hello-world');
	});

	it('strips accents and diacritics', () => {
		expect(slugify('Héllo Wörld')).toBe('hello-world');
	});

	it('collapses repeated separators into a single hyphen', () => {
		expect(slugify('a   b___c--d')).toBe('a-b-c-d');
	});

	it('trims leading separators', () => {
		expect(slugify('  !!Hello')).toBe('hello');
	});

	it('trims trailing separators', () => {
		expect(slugify('Hello!!  ')).toBe('hello');
	});

	it('drops emoji and other symbols', () => {
		expect(slugify('I ♥ TypeScript 🚀')).toBe('i-typescript');
	});

	it('keeps digits', () => {
		expect(slugify('Top 10 Tips')).toBe('top-10-tips');
	});

	it('returns an empty string when there is nothing slug-able', () => {
		expect(slugify('——')).toBe('');
		expect(slugify('')).toBe('');
	});
});

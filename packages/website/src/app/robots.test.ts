import { afterEach, describe, expect, it } from 'vitest';
import robots from './robots';

describe('robots.txt', () => {
	const original = process.env.RIVUS_ENV;

	afterEach(() => {
		if (original === undefined) {
			delete process.env.RIVUS_ENV;
		} else {
			process.env.RIVUS_ENV = original;
		}
	});

	it('allows all crawlers in production', () => {
		process.env.RIVUS_ENV = 'production';
		expect(robots().rules).toEqual({ userAgent: '*', allow: '/' });
	});

	it('disallows all crawlers in the development environment', () => {
		process.env.RIVUS_ENV = 'development';
		expect(robots().rules).toEqual({ userAgent: '*', disallow: '/' });
	});

	it('disallows all crawlers when RIVUS_ENV is unset', () => {
		delete process.env.RIVUS_ENV;
		expect(robots().rules).toEqual({ userAgent: '*', disallow: '/' });
	});
});

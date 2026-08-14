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

	it('allows all crawlers in production and points them at the sitemap', () => {
		process.env.RIVUS_ENV = 'production';
		expect(robots()).toEqual({
			rules: { userAgent: '*', allow: '/' },
			sitemap: 'https://rivus.ai/sitemap.xml',
		});
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

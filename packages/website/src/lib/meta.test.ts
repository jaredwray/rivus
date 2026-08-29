import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { manifest } from './manifest';
import { pageMeta } from './meta';
import { siteConfig } from './site';
import { publicRoutes } from './sitemap';

describe('page metadata', () => {
	it('declares a canonical on every static public page', () => {
		const staticRoutes = publicRoutes.filter((route) => !route.startsWith('/industries/'));
		for (const route of staticRoutes) {
			expect(pageMeta[route]?.canonical, `canonical for ${route}`).toBe(route);
		}
	});

	it('covers every static public route (dynamic industries handled in their own test)', () => {
		const staticRoutes = publicRoutes.filter((route) => !route.startsWith('/industries/'));
		expect(Object.keys(pageMeta).sort()).toEqual([...staticRoutes].sort());
	});

	it('gives the home page a unique title and description aimed at local businesses', () => {
		const homeMeta = pageMeta['/'];
		expect(homeMeta?.title).toBe(siteConfig.title);
		expect(homeMeta?.description).toBe(siteConfig.description);
		expect(homeMeta?.openGraph?.url).toBe('/');
		expect(homeMeta?.openGraph?.siteName).toBe(siteConfig.name);
		expect(homeMeta?.openGraph?.locale).toBe('en_US');
	});
});

describe('manifest', () => {
	it('identifies the site with the shared config and both icons', () => {
		const result = manifest();
		expect(result.short_name).toBe('Rivus');
		expect(result.start_url).toBe('/');
		expect(result.theme_color).toBe('#6e1ec8');
		expect(result.icons.map((icon) => icon.src)).toEqual(['/icon.svg', '/apple-icon.png']);
	});
});

describe('opengraph-image alt', () => {
	it('describes the raster card, which still uses the brand tagline', () => {
		const alt = readFileSync(
			join(dirname(fileURLToPath(import.meta.url)), 'opengraph-image.alt.txt'),
			'utf8',
		);
		expect(alt.trim().toLowerCase()).toContain(siteConfig.tagline.toLowerCase());
	});
});

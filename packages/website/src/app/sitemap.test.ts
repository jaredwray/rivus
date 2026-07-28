import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { footerColumns, navLinks } from '../lib/site';
import sitemap, { baseUrl, publicRoutes } from './sitemap';

describe('sitemap', () => {
	it('lists every public route exactly once, absolute against the production domain', () => {
		const entries = sitemap();
		expect(entries).toHaveLength(publicRoutes.length);
		const urls = entries.map((entry) => entry.url);
		expect(new Set(urls).size).toBe(urls.length);
		for (const url of urls) {
			expect(url.startsWith(`${baseUrl}/`) || url === `${baseUrl}/`).toBe(true);
		}
	});

	it('covers every internal page the nav and footer link to', () => {
		const linked = [
			...navLinks.map((link) => link.href),
			...footerColumns.flatMap((column) => column.links.map((link) => link.href)),
		]
			// Anchors ("/#pricing") live on the home page; external app links are not ours.
			.filter((href) => href.startsWith('/') && !href.startsWith('/#'));
		for (const href of linked) {
			expect(publicRoutes).toContain(href);
		}
	});

	it('ranks the home page highest', () => {
		const home = sitemap().at(0);
		expect(home?.url).toBe(`${baseUrl}/`);
		expect(home?.priority).toBe(1);
	});

	it('maps every public route to a page file that actually exists', () => {
		// Membership in `publicRoutes` alone can't prove a route is real — a typo
		// added to both the footer and this list would pass the checks above while
		// 404ing in production. Resolve each route to its page.tsx on disk.
		const appDir = dirname(fileURLToPath(import.meta.url));
		for (const route of publicRoutes) {
			const pageFile = join(appDir, ...route.split('/').filter(Boolean), 'page.tsx');
			expect(existsSync(pageFile), `${route} has no ${pageFile}`).toBe(true);
		}
	});
});

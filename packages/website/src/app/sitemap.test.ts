import { existsSync, readdirSync } from 'node:fs';
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
		// 404ing in production. Resolve each route to its page.tsx on disk,
		// falling back per segment to a dynamic `[param]` directory (the
		// /industries/[slug] pages).
		const appDir = dirname(fileURLToPath(import.meta.url));
		const resolveSegment = (dir: string, segment: string): string | null => {
			const exact = join(dir, segment);
			if (existsSync(exact)) {
				return exact;
			}
			const dynamic = readdirSync(dir).find((name) => name.startsWith('[') && name.endsWith(']'));
			return dynamic ? join(dir, dynamic) : null;
		};
		for (const route of publicRoutes) {
			let dir: string | null = appDir;
			for (const segment of route.split('/').filter(Boolean)) {
				dir = resolveSegment(dir, segment);
				if (dir === null) {
					break;
				}
			}
			const pageFile = dir ? join(dir, 'page.tsx') : null;
			expect(pageFile !== null && existsSync(pageFile), `${route} has no page file`).toBe(true);
		}
	});
});

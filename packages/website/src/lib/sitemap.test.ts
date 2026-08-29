import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { footerColumns, navLinks } from './site';
import { baseUrl, publicRoutes, serializeSitemap, sitemap } from './sitemap';

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

	it('ranks the home page highest, then trades and lead pages, then legal last', () => {
		const entries = sitemap();
		const byPath = new Map(entries.map((entry) => [entry.url.slice(baseUrl.length) || '/', entry]));
		expect(byPath.get('/')?.priority).toBe(1);
		expect(byPath.get('/industries/plumbers')?.priority).toBe(0.8);
		expect(byPath.get('/faq')?.priority).toBe(0.8);
		expect(byPath.get('/compare')?.priority).toBe(0.8);
		expect(byPath.get('/demo')?.priority).toBe(0.8);
		expect(byPath.get('/about')?.priority).toBe(0.6);
		expect(byPath.get('/privacy')?.priority).toBe(0.3);
	});

	it('stamps every entry with a build-time lastModified', () => {
		for (const entry of sitemap()) {
			expect(entry.lastModified).toBeInstanceOf(Date);
		}
	});

	it('serializes a valid urlset', () => {
		const xml = serializeSitemap(sitemap());
		expect(xml).toContain('<urlset');
		expect(xml).toContain(`${baseUrl}/faq`);
		expect(xml).toContain('<changefreq>');
	});

	it('maps every public route to a page file that actually exists', () => {
		const pagesDir = join(dirname(fileURLToPath(import.meta.url)), '../pages');
		expect(pageFileExists(pagesDir, '/')).toBe(true);
		for (const route of publicRoutes) {
			expect(pageFileExists(pagesDir, route), `${route} has no page file`).toBe(true);
		}
	});
});

function pageFileExists(pagesDir: string, route: string): boolean {
	if (route === '/') {
		return existsSync(join(pagesDir, 'index.astro'));
	}
	const parts = route.split('/').filter(Boolean);
	let current = pagesDir;
	for (let index = 0; index < parts.length; index++) {
		const part = parts[index];
		if (part === undefined) {
			return false;
		}
		const isLast = index === parts.length - 1;
		const astroFile = join(current, `${part}.astro`);
		const dir = join(current, part);
		if (isLast && existsSync(astroFile)) {
			return true;
		}
		if (existsSync(dir)) {
			if (isLast) {
				return existsSync(join(dir, 'index.astro'));
			}
			current = dir;
			continue;
		}
		const entries = existsSync(current) ? readdirSync(current) : [];
		const dynAstro = entries.find((name) => /^\[.+\]\.astro$/.test(name));
		if (isLast && dynAstro) {
			return true;
		}
		const dynDir = entries.find((name) => name.startsWith('[') && !name.endsWith('.astro'));
		if (dynDir) {
			current = join(current, dynDir);
			continue;
		}
		return false;
	}
	return existsSync(join(current, 'index.astro'));
}

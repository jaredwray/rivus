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
});

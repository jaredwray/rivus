import { industries } from './industries';

export const baseUrl = 'https://rivus.ai';

export interface SitemapEntry {
	url: string;
	lastModified: Date;
	changeFrequency: 'weekly' | 'monthly';
	priority: number;
}

/**
 * Every indexable public route. The per-business join pages and the admin
 * console are deliberately absent — they set `robots: noindex` and shouldn't
 * be advertised to crawlers. The per-trade pages are generated from the
 * industries data, so adding a trade adds its route here automatically.
 */
export const publicRoutes: readonly string[] = [
	'/',
	'/about',
	'/careers',
	'/contact',
	'/apps',
	'/compare',
	'/demo',
	'/faq',
	'/press',
	'/privacy',
	'/terms',
	'/security',
	'/sms-terms',
	'/sms-opt-in',
	'/acceptable-use',
	...industries.map((industry) => `/industries/${industry.slug}`),
];

/** Legal pages exist for crawlers, but they are not conversion or landing URLs. */
const legalRoutes = new Set([
	'/privacy',
	'/terms',
	'/security',
	'/sms-terms',
	'/sms-opt-in',
	'/acceptable-use',
]);

/** High-intent marketing URLs we want crawled ahead of company/legal pages. */
const leadRoutes = new Set(['/faq', '/compare', '/demo']);

function sitemapPriority(route: string): number {
	if (route === '/') {
		return 1;
	}
	if (route.startsWith('/industries/') || leadRoutes.has(route)) {
		return 0.8;
	}
	if (legalRoutes.has(route)) {
		return 0.3;
	}
	return 0.6;
}

export function sitemap(): SitemapEntry[] {
	// Build time is the honest lastModified for a fully static site: every
	// deploy re-renders every page.
	const lastModified = new Date();
	return publicRoutes.map((route) => ({
		url: `${baseUrl}${route}`,
		lastModified,
		changeFrequency: route === '/' || route.startsWith('/industries/') ? 'weekly' : 'monthly',
		priority: sitemapPriority(route),
	}));
}

export function serializeSitemap(entries: SitemapEntry[]): string {
	const urls = entries
		.map((entry) => {
			const lastmod = entry.lastModified.toISOString();
			return `  <url>
    <loc>${entry.url}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${entry.changeFrequency}</changefreq>
    <priority>${entry.priority.toFixed(1)}</priority>
  </url>`;
		})
		.join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

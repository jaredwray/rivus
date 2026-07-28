import type { MetadataRoute } from 'next';
import { industries } from '../lib/industries';

export const baseUrl = 'https://rivus.ai';

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

export default function sitemap(): MetadataRoute.Sitemap {
	return publicRoutes.map((route) => ({
		url: `${baseUrl}${route}`,
		changeFrequency: route === '/' ? 'weekly' : 'monthly',
		priority: route === '/' ? 1 : 0.6,
	}));
}

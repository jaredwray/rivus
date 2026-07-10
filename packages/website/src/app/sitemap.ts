import type { MetadataRoute } from 'next';

export const baseUrl = 'https://rivus.ai';

/**
 * Every indexable public route. The per-business join pages and the admin
 * console are deliberately absent — they set `robots: noindex` and shouldn't
 * be advertised to crawlers.
 */
export const publicRoutes = [
	'/',
	'/about',
	'/careers',
	'/contact',
	'/apps',
	'/privacy',
	'/terms',
	'/security',
	'/sms-terms',
	'/sms-opt-in',
	'/acceptable-use',
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
	return publicRoutes.map((route) => ({
		url: `${baseUrl}${route}`,
		changeFrequency: route === '/' ? 'weekly' : 'monthly',
		priority: route === '/' ? 1 : 0.6,
	}));
}

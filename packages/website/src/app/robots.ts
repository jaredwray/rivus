import type { MetadataRoute } from 'next';
import { isProductionEnv } from '../lib/env';
import { baseUrl } from './sitemap';

/**
 * `/robots.txt`. Only the production marketing site (rivus.ai) should be
 * crawled; every pre-production deployment (dev.rivus.ai) and local build
 * disallows all crawlers so it never lands in a search index.
 */
export default function robots(): MetadataRoute.Robots {
	if (!isProductionEnv()) {
		return { rules: { userAgent: '*', disallow: '/' } };
	}
	return {
		rules: { userAgent: '*', allow: '/' },
		sitemap: `${baseUrl}/sitemap.xml`,
	};
}

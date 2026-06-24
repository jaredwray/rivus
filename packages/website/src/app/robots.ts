import type { MetadataRoute } from 'next';
import { isProductionEnv } from '../lib/env';

/**
 * `/robots.txt`. Only the production marketing site (rivus.ai) should be
 * crawled; every pre-production deployment (dev.rivus.ai) and local build
 * disallows all crawlers so it never lands in a search index.
 */
export default function robots(): MetadataRoute.Robots {
	return {
		rules: isProductionEnv() ? { userAgent: '*', allow: '/' } : { userAgent: '*', disallow: '/' },
	};
}

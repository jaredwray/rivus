import { isProductionEnv } from './env';
import { baseUrl } from './sitemap';

export interface RobotsConfig {
	rules: { userAgent: string; allow?: string; disallow?: string };
	sitemap?: string;
}

/**
 * `/robots.txt`. Only the production marketing site (rivus.ai) should be
 * crawled; every pre-production deployment (dev.rivus.ai) and local build
 * disallows all crawlers so it never lands in a search index.
 */
export function robots(): RobotsConfig {
	if (!isProductionEnv()) {
		return { rules: { userAgent: '*', disallow: '/' } };
	}
	return {
		rules: { userAgent: '*', allow: '/' },
		sitemap: `${baseUrl}/sitemap.xml`,
	};
}

export function serializeRobots(config: RobotsConfig): string {
	const lines = [`User-agent: ${config.rules.userAgent}`];
	if (config.rules.allow !== undefined) {
		lines.push(`Allow: ${config.rules.allow}`);
	}
	if (config.rules.disallow !== undefined) {
		lines.push(`Disallow: ${config.rules.disallow}`);
	}
	if (config.sitemap) {
		lines.push(`Sitemap: ${config.sitemap}`);
	}
	return `${lines.join('\n')}\n`;
}

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Metadata } from 'next';
import { describe, expect, it } from 'vitest';
import { siteConfig } from '../lib/site';
import { metadata as aboutMeta } from './about/page';
import { metadata as acceptableUseMeta } from './acceptable-use/page';
import { metadata as appsMeta } from './apps/page';
import { metadata as careersMeta } from './careers/page';
import { metadata as compareMeta } from './compare/page';
import { metadata as contactMeta } from './contact/page';
import { metadata as demoMeta } from './demo/page';
import { metadata as faqMeta } from './faq/page';
import manifest from './manifest';
import { metadata as homeMeta } from './page';
import { metadata as pressMeta } from './press/page';
import { metadata as privacyMeta } from './privacy/page';
import { metadata as securityMeta } from './security/page';
import { publicRoutes } from './sitemap';
import { metadata as smsOptInMeta } from './sms-opt-in/page';
import { metadata as smsTermsMeta } from './sms-terms/page';
import { metadata as termsMeta } from './terms/page';

/**
 * The canonical URL each static public page declares. rivus.ai serves both
 * the apex and www, so every indexable page pins its canonical (resolved
 * absolute via the layout's metadataBase).
 */
const canonicals: Record<string, Metadata> = {
	'/': homeMeta,
	'/about': aboutMeta,
	'/careers': careersMeta,
	'/contact': contactMeta,
	'/apps': appsMeta,
	'/compare': compareMeta,
	'/demo': demoMeta,
	'/faq': faqMeta,
	'/press': pressMeta,
	'/privacy': privacyMeta,
	'/terms': termsMeta,
	'/security': securityMeta,
	'/sms-terms': smsTermsMeta,
	'/sms-opt-in': smsOptInMeta,
	'/acceptable-use': acceptableUseMeta,
};

describe('page metadata', () => {
	it('declares a canonical on every static public page', () => {
		for (const [route, metadata] of Object.entries(canonicals)) {
			expect(metadata.alternates?.canonical, `canonical for ${route}`).toBe(route);
		}
	});

	it('covers every static public route (dynamic industries handled in their own test)', () => {
		const staticRoutes = publicRoutes.filter((route) => !route.startsWith('/industries/'));
		expect(Object.keys(canonicals).sort()).toEqual([...staticRoutes].sort());
	});

	it('gives the home page a unique title and description aimed at local businesses', () => {
		expect(homeMeta.title).toBe(siteConfig.title);
		expect(homeMeta.description).toBe(siteConfig.description);
		expect(homeMeta.openGraph?.url).toBe('/');
		// Page-level openGraph replaces the layout object, so these have to be
		// restated or og:site_name / og:locale drop off `/`.
		expect(homeMeta.openGraph?.siteName).toBe(siteConfig.name);
		expect(homeMeta.openGraph?.locale).toBe('en_US');
	});
});

describe('manifest', () => {
	it('identifies the site with the shared config and both icons', () => {
		const result = manifest();
		expect(result.short_name).toBe('Rivus');
		expect(result.start_url).toBe('/');
		expect(result.theme_color).toBe('#6e1ec8');
		expect(result.icons?.map((icon) => icon.src)).toEqual(['/icon.svg', '/apple-icon.png']);
	});
});

describe('opengraph-image alt', () => {
	it('describes the raster card, which still uses the brand tagline', () => {
		const alt = readFileSync(
			join(dirname(fileURLToPath(import.meta.url)), 'opengraph-image.alt.txt'),
			'utf8',
		);
		expect(alt.trim().toLowerCase()).toContain(siteConfig.tagline.toLowerCase());
	});
});

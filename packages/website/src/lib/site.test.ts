import { describe, expect, it } from 'vitest';
import { apiUrl, type Feature, featureAnchor, features, pricingTiers } from './site';

describe('site content', () => {
	it('derives a url-safe anchor from a feature title', () => {
		const feature: Feature = {
			title: 'Smart FAQs',
			description: '',
			icon: 'doc',
			tint: 'violet',
		};
		expect(featureAnchor(feature)).toBe('smart-faqs');
	});

	it('ships features with unique anchors', () => {
		const anchors = features.map(featureAnchor);
		expect(new Set(anchors).size).toBe(features.length);
	});

	it('marks exactly one pricing tier as the featured plan', () => {
		expect(pricingTiers.filter((tier) => tier.featured)).toHaveLength(1);
	});

	it('falls back to a local api url', () => {
		expect(apiUrl).toMatch(/^https?:\/\//);
	});
});

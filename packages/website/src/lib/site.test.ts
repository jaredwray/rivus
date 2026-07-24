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

	it('publishes a real monthly price on every tier — no contact-sales pricing', () => {
		for (const tier of pricingTiers) {
			expect(tier.price).toMatch(/^\$\d/);
			expect(tier.period).toBe('/mo');
		}
	});

	it('ships the same feature set on every tier — plans differ only by capacity', () => {
		const [first, ...rest] = pricingTiers;
		if (!first) throw new Error('no pricing tiers defined');
		expect(first.features.length).toBeGreaterThan(0);
		for (const tier of rest) {
			expect(tier.features).toEqual(first.features);
			expect(tier.capacity.length).toBeGreaterThan(0);
		}
	});

	it('falls back to a local api url', () => {
		expect(apiUrl).toMatch(/^https?:\/\//);
	});
});

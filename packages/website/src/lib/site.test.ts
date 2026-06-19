import { describe, expect, it } from 'vitest';
import { apiUrl, type Feature, featureAnchor, features } from './site';

describe('site config', () => {
	it('derives a url-safe anchor from a feature title', () => {
		const feature: Feature = { title: 'Edge Worker', description: '' };
		expect(featureAnchor(feature)).toBe('edge-worker');
	});

	it('ships features with unique anchors', () => {
		const anchors = features.map(featureAnchor);
		expect(new Set(anchors).size).toBe(features.length);
	});

	it('falls back to a local api url', () => {
		expect(apiUrl).toMatch(/^https?:\/\//);
	});
});

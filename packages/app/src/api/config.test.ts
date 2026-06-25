import { describe, expect, it } from 'vitest';
import { DEFAULT_API_URL, getApiBaseUrl, getGoogleMapsApiKey } from './config';

describe('getApiBaseUrl', () => {
	it('returns the configured EXPO_PUBLIC_API_URL when set', () => {
		expect(getApiBaseUrl({ EXPO_PUBLIC_API_URL: 'https://api.rivus.dev' })).toBe(
			'https://api.rivus.dev',
		);
	});

	it('trims surrounding whitespace from the configured URL', () => {
		expect(getApiBaseUrl({ EXPO_PUBLIC_API_URL: '  https://api.rivus.dev  ' })).toBe(
			'https://api.rivus.dev',
		);
	});

	it('falls back to the default when the var is missing', () => {
		expect(getApiBaseUrl({})).toBe(DEFAULT_API_URL);
	});

	it('falls back to the default when the var is blank', () => {
		expect(getApiBaseUrl({ EXPO_PUBLIC_API_URL: '   ' })).toBe(DEFAULT_API_URL);
	});

	it('reads from process.env by default', () => {
		// No throw, returns a string regardless of ambient env.
		expect(typeof getApiBaseUrl()).toBe('string');
	});
});

describe('getGoogleMapsApiKey', () => {
	it('returns the key when set', () => {
		expect(getGoogleMapsApiKey({ EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: 'AIza-test' })).toBe('AIza-test');
	});

	it('trims surrounding whitespace', () => {
		expect(getGoogleMapsApiKey({ EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: '  AIza-test  ' })).toBe(
			'AIza-test',
		);
	});

	it('returns null when unset or blank', () => {
		expect(getGoogleMapsApiKey({})).toBeNull();
		expect(getGoogleMapsApiKey({ EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: '   ' })).toBeNull();
	});

	it('reads from process.env by default without throwing', () => {
		const key = getGoogleMapsApiKey();
		expect(key === null || typeof key === 'string').toBe(true);
	});
});

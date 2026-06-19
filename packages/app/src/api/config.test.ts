import { describe, expect, it } from 'vitest';
import { DEFAULT_API_URL, getApiBaseUrl } from './config';

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

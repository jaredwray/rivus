import { describe, expect, it } from 'vitest';
import { isProductionEnv, resolveAppUrl } from './env';

describe('isProductionEnv', () => {
	it('is true only when RIVUS_ENV is exactly "production"', () => {
		expect(isProductionEnv({ RIVUS_ENV: 'production' })).toBe(true);
	});

	it('is false for the development environment', () => {
		expect(isProductionEnv({ RIVUS_ENV: 'development' })).toBe(false);
	});

	it('is false when RIVUS_ENV is unset (e.g. local builds)', () => {
		expect(isProductionEnv({})).toBe(false);
	});

	it('reads from process.env by default', () => {
		// No throw, returns a boolean regardless of ambient env.
		expect(typeof isProductionEnv()).toBe('boolean');
	});
});

describe('resolveAppUrl', () => {
	it('points the development deploy at the dev app', () => {
		expect(resolveAppUrl({ RIVUS_ENV: 'development' })).toBe('https://dev-app.rivus.ai');
	});

	it('points production at the production app', () => {
		expect(resolveAppUrl({ RIVUS_ENV: 'production' })).toBe('https://app.rivus.ai');
	});

	it('defaults local builds (RIVUS_ENV unset) to the production app', () => {
		expect(resolveAppUrl({})).toBe('https://app.rivus.ai');
	});

	it('lets NEXT_PUBLIC_APP_URL override the environment mapping', () => {
		expect(
			resolveAppUrl({ RIVUS_ENV: 'development', NEXT_PUBLIC_APP_URL: 'http://localhost:8081' }),
		).toBe('http://localhost:8081');
	});

	it('reads from process.env by default', () => {
		expect(resolveAppUrl()).toMatch(/^https?:\/\//);
	});
});

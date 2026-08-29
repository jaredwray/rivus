import { describe, expect, it } from 'vitest';
import { isProductionEnv, resolveAppUrl, resolveDocsUrl } from './env';

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

	it('lets PUBLIC_APP_URL override the environment mapping', () => {
		expect(
			resolveAppUrl({ RIVUS_ENV: 'development', PUBLIC_APP_URL: 'http://localhost:8081' }),
		).toBe('http://localhost:8081');
	});

	it('still honors the legacy NEXT_PUBLIC_APP_URL override', () => {
		expect(
			resolveAppUrl({ RIVUS_ENV: 'development', NEXT_PUBLIC_APP_URL: 'http://localhost:8081' }),
		).toBe('http://localhost:8081');
	});

	it('prefers PUBLIC_APP_URL when both overrides are set', () => {
		expect(
			resolveAppUrl({
				PUBLIC_APP_URL: 'http://localhost:4321',
				NEXT_PUBLIC_APP_URL: 'http://localhost:8081',
			}),
		).toBe('http://localhost:4321');
	});

	it('strips trailing slashes from the override so appended paths stay clean', () => {
		expect(resolveAppUrl({ PUBLIC_APP_URL: 'https://app.example.com/' })).toBe(
			'https://app.example.com',
		);
	});

	it('reads from process.env by default', () => {
		expect(resolveAppUrl()).toMatch(/^https?:\/\//);
	});
});

describe('resolveDocsUrl', () => {
	it('points the development deploy at the dev docs', () => {
		expect(resolveDocsUrl({ RIVUS_ENV: 'development' })).toBe('https://dev-docs.rivus.ai');
	});

	it('points production at the production docs', () => {
		expect(resolveDocsUrl({ RIVUS_ENV: 'production' })).toBe('https://docs.rivus.ai');
	});

	it('defaults local builds (RIVUS_ENV unset) to the production docs', () => {
		expect(resolveDocsUrl({})).toBe('https://docs.rivus.ai');
	});

	it('lets PUBLIC_DOCS_URL override the environment mapping', () => {
		expect(
			resolveDocsUrl({ RIVUS_ENV: 'development', PUBLIC_DOCS_URL: 'http://localhost:3010' }),
		).toBe('http://localhost:3010');
	});

	it('still honors the legacy NEXT_PUBLIC_DOCS_URL override', () => {
		expect(
			resolveDocsUrl({ RIVUS_ENV: 'development', NEXT_PUBLIC_DOCS_URL: 'http://localhost:3010' }),
		).toBe('http://localhost:3010');
	});

	it('strips trailing slashes from the override so appended paths stay clean', () => {
		expect(resolveDocsUrl({ PUBLIC_DOCS_URL: 'https://docs.example.com/' })).toBe(
			'https://docs.example.com',
		);
	});

	it('reads from process.env by default', () => {
		expect(resolveDocsUrl()).toMatch(/^https?:\/\//);
	});
});

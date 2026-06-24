import { describe, expect, it } from 'vitest';
import { loadConfig, parseCorsOrigin } from '../src/config';

describe('loadConfig', () => {
	it('applies development defaults', () => {
		const config = loadConfig({} as NodeJS.ProcessEnv);
		expect(config.NODE_ENV).toBe('development');
		expect(config.API_PORT).toBe(4000);
	});

	it('coerces API_PORT from a string', () => {
		expect(loadConfig({ API_PORT: '8080' } as NodeJS.ProcessEnv).API_PORT).toBe(8080);
	});

	it('rejects the default JWT secret in production', () => {
		expect(() => loadConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow();
	});

	it('rejects a short JWT secret in production', () => {
		expect(() =>
			loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'nine-char' } as NodeJS.ProcessEnv),
		).toThrow();
	});

	it('accepts a strong JWT secret in production', () => {
		const config = loadConfig({
			NODE_ENV: 'production',
			JWT_SECRET: 'x'.repeat(40),
		} as NodeJS.ProcessEnv);
		expect(config.NODE_ENV).toBe('production');
	});
});

describe('parseCorsOrigin', () => {
	it('allows any origin for the "*" default', () => {
		expect(parseCorsOrigin('*')).toBe('*');
	});

	it('returns false when no origins are configured', () => {
		expect(parseCorsOrigin('')).toBe(false);
		expect(parseCorsOrigin('  ,  ')).toBe(false);
	});

	it('keeps a single exact origin as a string', () => {
		expect(parseCorsOrigin('https://app.rivus.ai')).toBe('https://app.rivus.ai');
	});

	it('splits a comma-separated list into exact origins', () => {
		expect(parseCorsOrigin('https://app.rivus.ai, https://www.rivus.ai')).toEqual([
			'https://app.rivus.ai',
			'https://www.rivus.ai',
		]);
	});

	it('falls back to allow-all when "*" appears anywhere in the list', () => {
		expect(parseCorsOrigin('https://app.rivus.ai,*')).toBe('*');
	});

	it('turns a subdomain wildcard into a matching regex', () => {
		const origin = parseCorsOrigin('*.rivus.ai');
		expect(origin).toBeInstanceOf(RegExp);
		const re = origin as RegExp;
		expect(re.test('https://app.rivus.ai')).toBe(true);
		expect(re.test('https://www.rivus.ai')).toBe(true);
		expect(re.test('http://app.rivus.ai')).toBe(true);
		// Not the apex, not nested subdomains, not look-alikes.
		expect(re.test('https://rivus.ai')).toBe(false);
		expect(re.test('https://a.b.rivus.ai')).toBe(false);
		expect(re.test('https://app.rivus.ai.evil.com')).toBe(false);
		expect(re.test('https://evil.com')).toBe(false);
	});

	it('honours an explicit scheme in a wildcard', () => {
		const origin = parseCorsOrigin('https://*.rivus.ai');
		expect(origin).toBeInstanceOf(RegExp);
		const re = origin as RegExp;
		expect(re.test('https://app.rivus.ai')).toBe(true);
		expect(re.test('http://app.rivus.ai')).toBe(false);
	});
});

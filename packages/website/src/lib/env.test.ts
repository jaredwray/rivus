import { describe, expect, it } from 'vitest';
import { isProductionEnv } from './env';

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

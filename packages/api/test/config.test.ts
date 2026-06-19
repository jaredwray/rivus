import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

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

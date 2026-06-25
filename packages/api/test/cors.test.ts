import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createInMemoryRepositories } from '../src/repositories/memory';
import { RecordingMailer } from './helpers';

/** Build an app with a specific CORS_ORIGIN so we can exercise both origin branches. */
function buildAppWithCors(corsOrigin: string): FastifyInstance {
	const repos = createInMemoryRepositories();
	return buildApp({
		config: loadConfig({
			NODE_ENV: 'test',
			JWT_SECRET: 'test-secret-value-1234',
			CORS_ORIGIN: corsOrigin,
		} as NodeJS.ProcessEnv),
		...repos,
		mailer: new RecordingMailer(),
		ping: async () => ({ ready: true }),
	});
}

/** Build an app with a production config (with the secrets the prod guards require). */
function buildProdApp(corsOrigin: string): FastifyInstance {
	const repos = createInMemoryRepositories();
	return buildApp({
		config: loadConfig({
			NODE_ENV: 'production',
			JWT_SECRET: 'x'.repeat(32),
			RESEND_API_KEY: 'test-resend-key',
			LOG_LEVEL: 'silent',
			CORS_ORIGIN: corsOrigin,
		} as NodeJS.ProcessEnv),
		...repos,
		mailer: new RecordingMailer(),
		ping: async () => ({ ready: true }),
	});
}

/** Send a CORS preflight for a cross-origin POST from `origin`. */
function preflight(app: FastifyInstance, origin: string) {
	return app.inject({
		method: 'OPTIONS',
		url: '/v1/auth/login',
		headers: { origin, 'access-control-request-method': 'POST' },
	});
}

describe('CORS', () => {
	let app: FastifyInstance | undefined;

	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('echoes an allowlisted origin and allows credentials (cookies)', async () => {
		app = buildAppWithCors('https://app.rivus.ai,https://www.rivus.ai');
		const res = await preflight(app, 'https://app.rivus.ai');

		expect(res.headers['access-control-allow-origin']).toBe('https://app.rivus.ai');
		expect(res.headers['access-control-allow-credentials']).toBe('true');
	});

	it('does not authorize an origin outside the allowlist', async () => {
		app = buildAppWithCors('https://app.rivus.ai,https://www.rivus.ai');
		const res = await preflight(app, 'https://evil.example');

		expect(res.headers['access-control-allow-origin']).toBeUndefined();
	});

	it('reflects the request origin when wide-open, still with credentials', async () => {
		// The dev default `*` can't be sent verbatim on a credentialed request, so the
		// app reflects the caller's origin instead.
		app = buildAppWithCors('*');
		const res = await preflight(app, 'https://anything.example');

		expect(res.headers['access-control-allow-origin']).toBe('https://anything.example');
		expect(res.headers['access-control-allow-credentials']).toBe('true');
	});

	it('refuses to boot with a wildcard origin in production (credentialed CORS)', () => {
		// Reflecting any origin with credentials would authorize every site, so a
		// `*` wildcard must fail fast under NODE_ENV=production rather than reflect.
		expect(() => buildProdApp('*')).toThrow(/CORS_ORIGIN/);
	});

	it('boots in production with an explicit allowlist', async () => {
		app = buildProdApp('https://rivus.ai,*.rivus.ai');
		const res = await preflight(app, 'https://app.rivus.ai');

		expect(res.headers['access-control-allow-origin']).toBe('https://app.rivus.ai');
		expect(res.headers['access-control-allow-credentials']).toBe('true');
	});
});

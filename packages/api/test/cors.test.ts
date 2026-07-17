import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { SESSION_COOKIE } from '../src/plugins/auth';
import { createInMemoryRepositories } from '../src/repositories/memory';
import { NoopReceivedEmailReader } from '../src/services/agent/email/received';
import { NoopChannelProvisioner, NoopNumberReleaser } from '../src/services/channel-provisioning';
import { createDecider } from '../src/services/chat/decide';
import { NoopFaqAnswerService } from '../src/services/faq-answer';
import { NoopFaqSimilarityService } from '../src/services/faq-similarity';
import { createNotificationService } from '../src/services/notifications';
import { NoopSmsSender } from '../src/services/sms';
import { createWebsiteAuditService } from '../src/services/website-audit';
import { NoopWhatsappSender } from '../src/services/whatsapp';
import { authHeader, RecordingMailer, signupOwner } from './helpers';

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
		receivedEmails: new NoopReceivedEmailReader(),
		whatsappSender: new NoopWhatsappSender(),
		whatsappProvisioner: new NoopChannelProvisioner(),
		smsSender: new NoopSmsSender(),
		smsProvisioner: new NoopChannelProvisioner(),
		numberReleaser: new NoopNumberReleaser(),
		notifier: createNotificationService({ notifications: repos.notifications }),
		faqSimilarity: new NoopFaqSimilarityService(),
		faqAnswer: new NoopFaqAnswerService(),
		chatDecider: createDecider(),
		websiteAudit: createWebsiteAuditService({}),
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
		receivedEmails: new NoopReceivedEmailReader(),
		whatsappSender: new NoopWhatsappSender(),
		whatsappProvisioner: new NoopChannelProvisioner(),
		smsSender: new NoopSmsSender(),
		smsProvisioner: new NoopChannelProvisioner(),
		numberReleaser: new NoopNumberReleaser(),
		notifier: createNotificationService({ notifications: repos.notifications }),
		faqSimilarity: new NoopFaqSimilarityService(),
		faqAnswer: new NoopFaqAnswerService(),
		chatDecider: createDecider(),
		websiteAudit: createWebsiteAuditService({}),
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

	it('grants credentials only to the app origin, not other allowlisted origins', async () => {
		// The default test APP_URL is https://app.rivus.ai. A sibling origin (the
		// marketing site) is still allowlisted for plain CORS — so public reads like
		// /health work — but must NOT get credentialed CORS, or it could read a
		// signed-in user's cookie-authenticated responses once the cookie is
		// parent-domain scoped.
		app = buildAppWithCors('https://app.rivus.ai,https://www.rivus.ai');
		const res = await preflight(app, 'https://www.rivus.ai');

		expect(res.headers['access-control-allow-origin']).toBe('https://www.rivus.ai');
		expect(res.headers['access-control-allow-credentials']).toBeUndefined();
	});

	it('advertises the write verbs the API serves (PATCH, DELETE) in preflight', async () => {
		// `@fastify/cors` v11 narrowed its default `methods` to `GET,HEAD,POST`. Without
		// an explicit list, a cross-origin PATCH/DELETE preflight (editing or deleting an
		// FAQ, updating account settings) is answered without that verb in
		// `Access-Control-Allow-Methods`, so the browser blocks the real request and
		// `fetch` rejects with "Failed to fetch". Preflight an authenticated route — the
		// FAQ edit path — to mirror where that surfaced.
		app = buildAppWithCors('https://app.rivus.ai');
		const res = await app.inject({
			method: 'OPTIONS',
			url: '/v1/faqs/some-id',
			headers: {
				origin: 'https://app.rivus.ai',
				'access-control-request-method': 'PATCH',
			},
		});
		const allowed = String(res.headers['access-control-allow-methods'] ?? '');
		expect(allowed).toContain('PATCH');
		expect(allowed).toContain('DELETE');
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

describe('CSRF (cookie-authenticated writes)', () => {
	let app: FastifyInstance | undefined;

	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	// The default test APP_URL is https://app.rivus.ai, so that's the only origin
	// allowed to make cookie-authenticated writes. An allowlist CORS value (not `*`)
	// activates the guard. The session cookie value is the JWT, which `signupOwner`
	// returns as `token`.
	it('blocks a cookie-authenticated write from a foreign origin', async () => {
		app = buildAppWithCors('https://app.rivus.ai,*.rivus.ai');
		const owner = await signupOwner(app);

		const res = await app.inject({
			method: 'POST',
			url: '/v1/account/cancel',
			cookies: { [SESSION_COOKIE]: owner.token },
			headers: { origin: 'https://evil.example' },
		});

		expect(res.statusCode).toBe(403);
	});

	it('allows a cookie-authenticated write from the app origin', async () => {
		app = buildAppWithCors('https://app.rivus.ai,*.rivus.ai');
		const owner = await signupOwner(app);

		const res = await app.inject({
			method: 'POST',
			url: '/v1/account/cancel',
			cookies: { [SESSION_COOKIE]: owner.token },
			headers: { origin: 'https://app.rivus.ai' },
		});

		expect(res.statusCode).toBe(200);
	});

	it('does not guard bearer-authenticated writes (native clients)', async () => {
		app = buildAppWithCors('https://app.rivus.ai,*.rivus.ai');
		const owner = await signupOwner(app);

		// No cookie, a bearer header, and no Origin — a native request, not CSRF-able.
		const res = await app.inject({
			method: 'POST',
			url: '/v1/account/cancel',
			headers: authHeader(owner.token),
		});

		expect(res.statusCode).toBe(200);
	});
});

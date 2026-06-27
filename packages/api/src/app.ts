import cors, { type FastifyCorsOptionsDelegateCallback } from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import {
	hasZodFastifySchemaValidationErrors,
	serializerCompiler,
	validatorCompiler,
} from 'fastify-type-provider-zod';
import { parseCorsOrigin } from './config';
import authPlugin, { SESSION_COOKIE } from './plugins/auth';
import swaggerPlugin from './plugins/swagger';
import { ConflictError, InviteNotPendingError, LastOwnerError } from './repositories/errors';
import { accountRoutes } from './routes/account';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { billingRoutes } from './routes/billing';
import { customerRoutes } from './routes/customers';
import { faqRoutes } from './routes/faqs';
import { healthRoutes } from './routes/health';
import { itemRoutes } from './routes/items';
import { memberRoutes } from './routes/members';
import type { AppDeps } from './types';

function buildLogger(deps: AppDeps) {
	if (deps.config.NODE_ENV === 'test') {
		return false;
	}
	if (deps.config.NODE_ENV === 'development') {
		return { level: deps.config.LOG_LEVEL, transport: { target: 'pino-pretty' } };
	}
	return { level: deps.config.LOG_LEVEL };
}

/**
 * Build a fully wired Fastify instance. Repositories are injected via `deps`,
 * so tests can pass in-memory stores and production can pass Mongo-backed ones.
 * The caller is responsible for `await app.ready()` (or `app.inject`, which
 * readies automatically).
 */
export function buildApp(deps: AppDeps): FastifyInstance {
	const app = Fastify({ logger: buildLogger(deps) });

	app.setValidatorCompiler(validatorCompiler);
	app.setSerializerCompiler(serializerCompiler);
	app.decorate('deps', deps);

	app.setErrorHandler((error: FastifyError, request, reply) => {
		if (hasZodFastifySchemaValidationErrors(error)) {
			// Lead with the first field's friendly message (the schemas spell these out
			// in plain language) so a client that only shows `message` still says
			// something useful; `details` keeps the full per-field breakdown.
			const [firstIssue] = error.validation;
			return reply.status(400).send({
				error: 'Bad Request',
				message: firstIssue?.message ?? 'Request validation failed',
				statusCode: 400,
				details: error.validation,
			});
		}

		if (error instanceof ConflictError) {
			return reply.status(409).send({
				error: 'Conflict',
				message: error.message,
				statusCode: 409,
			});
		}

		if (error instanceof InviteNotPendingError) {
			return reply.status(401).send({
				error: 'Unauthorized',
				message: error.message,
				statusCode: 401,
			});
		}

		if (error instanceof LastOwnerError) {
			return reply.status(409).send({
				error: 'Conflict',
				message: error.message,
				statusCode: 409,
			});
		}

		const statusCode = error.statusCode ?? 500;
		if (statusCode >= 500) {
			request.log.error({ err: error }, 'request failed');
			return reply.status(500).send({
				error: 'Internal Server Error',
				message: 'An unexpected error occurred',
				statusCode: 500,
			});
		}

		return reply.status(statusCode).send({
			error: error.name,
			message: error.message,
			statusCode,
		});
	});

	app.register(sensible);
	const corsOrigin = parseCorsOrigin(deps.config.CORS_ORIGIN);
	// Credentialed CORS can't safely use a wildcard: reflecting any origin while
	// `credentials: true` lets any site make authenticated cross-origin requests and
	// read the response. Require an explicit allowlist in production (the deployed
	// dev and prod containers both run NODE_ENV=production); only local development
	// may stay wide-open, where reflecting localhost origins is harmless.
	if (deps.config.NODE_ENV === 'production' && corsOrigin === '*') {
		throw new Error(
			'CORS_ORIGIN must be an explicit origin allowlist in production, not "*": credentialed CORS reflects the request origin, so a wildcard would authorize every site.',
		);
	}
	// The app's own origin: the only one allowed to make *credentialed* (cookie-
	// bearing) cross-origin requests in deployed environments (see below).
	const appOrigin = new URL(deps.config.APP_URL).origin;
	// A per-request CORS delegate so credentials can vary by origin.
	//
	// Web clients send the session cookie cross-origin (app.rivus.ai →
	// api.rivus.ai), which requires credentialed CORS — and a credentialed response
	// can't use a wildcard `Access-Control-Allow-Origin`, so reflect the request
	// origin when wide-open (local dev only) and otherwise echo only the configured
	// allowlist. The session cookie is scoped to the parent domain (`.rivus.ai`) so
	// it also reaches the app and the agent — which means a *sibling* subdomain
	// (marketing, docs) could send it too. To stop those origins from *reading*
	// cookie-authenticated responses, credentialed CORS is granted only to the app's
	// own origin; other allowlisted origins still get plain CORS for public reads
	// (e.g. `/health`). Local dev (wildcard) stays fully permissive.
	const corsDelegate: FastifyCorsOptionsDelegateCallback = (request, callback) => {
		const credentials = corsOrigin === '*' || request.headers.origin === appOrigin;
		callback(null, {
			origin: corsOrigin === '*' ? true : corsOrigin,
			credentials,
			// `@fastify/cors` v11 narrowed its default `methods` to `GET,HEAD,POST`, so
			// preflight for any other verb answers without it in
			// `Access-Control-Allow-Methods` — the browser then blocks the real request
			// and `fetch` rejects with "Failed to fetch". The web app's writes are
			// cross-origin (app.rivus.ai → api.rivus.ai) and preflighted, so without
			// this every PATCH (edit FAQ, update account) and DELETE (remove FAQ) fails.
			// Advertise exactly the verbs the API serves.
			methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'],
		});
	};
	app.register(cors, () => corsDelegate);

	// CSRF defense for cookie-authenticated writes. The session cookie rides along
	// automatically on same-site requests, so a malicious or compromised same-site
	// page could trigger a state-changing call with the victim's session. Bearer
	// (native) and unauthenticated requests aren't CSRF-able, so we guard only the
	// unsafe methods that actually carry the session cookie, and require the request
	// to originate from the app itself. Local development (wildcard CORS) stays
	// permissive; the deployed environments (an explicit allowlist) enforce it.
	const enforceCsrf = corsOrigin !== '*';
	app.addHook('onRequest', async (request) => {
		if (!enforceCsrf || request.method === 'GET' || request.method === 'HEAD') {
			return;
		}
		const hasSession = request.headers.cookie
			?.split(';')
			.some((entry) => entry.trimStart().startsWith(`${SESSION_COOKIE}=`));
		if (!hasSession) {
			return;
		}
		if (request.headers.origin !== appOrigin) {
			throw app.httpErrors.forbidden('Cross-origin request blocked');
		}
	});

	app.register(helmet, { contentSecurityPolicy: false });
	app.register(authPlugin);
	app.register(swaggerPlugin);

	app.register(healthRoutes);
	app.register(authRoutes, { prefix: '/v1/auth' });
	app.register(memberRoutes, { prefix: '/v1/members' });
	app.register(accountRoutes, { prefix: '/v1/account' });
	app.register(adminRoutes, { prefix: '/v1/admin' });
	app.register(billingRoutes, { prefix: '/v1/billing' });
	app.register(itemRoutes, { prefix: '/v1/items' });
	app.register(faqRoutes, { prefix: '/v1/faqs' });
	app.register(customerRoutes, { prefix: '/v1/customers' });

	return app;
}

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import {
	hasZodFastifySchemaValidationErrors,
	serializerCompiler,
	validatorCompiler,
} from 'fastify-type-provider-zod';
import { parseCorsOrigin } from './config';
import authPlugin from './plugins/auth';
import swaggerPlugin from './plugins/swagger';
import { ConflictError, InviteNotPendingError, LastOwnerError } from './repositories/errors';
import { accountRoutes } from './routes/account';
import { authRoutes } from './routes/auth';
import { billingRoutes } from './routes/billing';
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
	app.register(cors, {
		// Web clients send the session cookie cross-origin (app.rivus.ai →
		// api.rivus.ai), which requires credentialed CORS. A credentialed request
		// can't use a wildcard `Access-Control-Allow-Origin`, so reflect the request
		// origin when configured wide-open (the dev default) and otherwise echo only
		// the configured allowlist.
		origin: corsOrigin === '*' ? true : corsOrigin,
		credentials: true,
	});
	app.register(helmet, { contentSecurityPolicy: false });
	app.register(authPlugin);
	app.register(swaggerPlugin);

	app.register(healthRoutes);
	app.register(authRoutes, { prefix: '/v1/auth' });
	app.register(memberRoutes, { prefix: '/v1/members' });
	app.register(accountRoutes, { prefix: '/v1/account' });
	app.register(billingRoutes, { prefix: '/v1/billing' });
	app.register(itemRoutes, { prefix: '/v1/items' });

	return app;
}

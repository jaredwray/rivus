import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import {
	hasZodFastifySchemaValidationErrors,
	serializerCompiler,
	validatorCompiler,
} from 'fastify-type-provider-zod';
import authPlugin from './plugins/auth';
import swaggerPlugin from './plugins/swagger';
import { ConflictError } from './repositories/errors';
import { authRoutes } from './routes/auth';
import { healthRoutes } from './routes/health';
import { itemRoutes } from './routes/items';
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
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Request validation failed',
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
	app.register(cors, { origin: deps.config.CORS_ORIGIN });
	app.register(helmet, { contentSecurityPolicy: false });
	app.register(authPlugin);
	app.register(swaggerPlugin);

	app.register(healthRoutes);
	app.register(authRoutes, { prefix: '/v1/auth' });
	app.register(itemRoutes, { prefix: '/v1/items' });

	return app;
}

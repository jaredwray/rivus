import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fp from 'fastify-plugin';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

/** OpenAPI generation (always) plus an interactive UI outside production. */
export default fp(
	async (app) => {
		await app.register(fastifySwagger, {
			openapi: {
				info: {
					title: 'Rivus API',
					description: 'REST API for Rivus.',
					version: '0.0.0',
				},
				servers: [{ url: '/', description: 'This server' }],
				components: {
					securitySchemes: {
						bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
					},
				},
				tags: [
					{ name: 'system', description: 'Health and readiness probes' },
					{ name: 'auth', description: 'Registration, login, and identity' },
					{ name: 'items', description: 'Owner-scoped item resources' },
				],
			},
			transform: jsonSchemaTransform,
		});

		if (app.deps.config.NODE_ENV !== 'production') {
			await app.register(fastifySwaggerUi, { routePrefix: '/docs' });
		}
	},
	{ name: 'swagger' },
);

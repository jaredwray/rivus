import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers';

describe('health', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		app = await buildTestApp();
	});

	afterEach(async () => {
		await app.close();
	});

	it('reports ok with an uptime and timestamp', async () => {
		const response = await app.inject({ method: 'GET', url: '/health' });

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.status).toBe('ok');
		expect(body.uptime).toBeTypeOf('number');
		expect(typeof body.timestamp).toBe('string');
	});

	it('generates an OpenAPI document from the route schemas', () => {
		const spec = app.swagger() as { openapi: string; paths: Record<string, unknown> };

		expect(spec.openapi).toMatch(/^3\./);
		expect(spec.paths['/v1/auth/register']).toBeDefined();
		expect(Object.keys(spec.paths).some((path) => path.startsWith('/v1/items'))).toBe(true);
	});

	it('returns a structured 404 for unknown routes', async () => {
		const response = await app.inject({ method: 'GET', url: '/nope' });

		expect(response.statusCode).toBe(404);
		expect(response.json()).toMatchObject({ statusCode: 404 });
	});
});

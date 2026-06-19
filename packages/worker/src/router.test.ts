import { describe, expect, it, vi } from 'vitest';
import { handleRequest } from './router';
import type { Env } from './types';

const env: Env = { API_BASE_URL: 'https://api.test' };

function request(path: string, init?: RequestInit): Request {
	return new Request(`https://worker.test${path}`, init);
}

describe('handleRequest', () => {
	it('returns ok for /health', async () => {
		const response = await handleRequest(request('/health'), env);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'ok' });
	});

	it('lists tasks at /tasks', async () => {
		const response = await handleRequest(request('/tasks'), env);
		const body = (await response.json()) as { tasks: string[] };

		expect(body.tasks).toContain('healthcheck');
	});

	it('runs a task via POST /tasks/:name/run', async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValue(new Response('{}', { status: 200 }));
		const response = await handleRequest(
			request('/tasks/healthcheck/run', { method: 'POST' }),
			env,
			fetch,
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ task: 'healthcheck', ok: true });
	});

	it('rejects a non-POST run with 405', async () => {
		const response = await handleRequest(request('/tasks/healthcheck/run'), env);
		expect(response.status).toBe(405);
	});

	it('returns 404 for an unknown task', async () => {
		const response = await handleRequest(request('/tasks/ghost/run', { method: 'POST' }), env);
		expect(response.status).toBe(404);
	});

	it('returns 404 for an unknown route', async () => {
		const response = await handleRequest(request('/nope'), env);
		expect(response.status).toBe(404);
	});
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './index';
import type { Env } from './types';

const env: Env = { API_BASE_URL: 'https://api.test' };

describe('worker handler', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('serves the fetch handler', async () => {
		const response = await worker.fetch(new Request('https://worker.test/health'), env);
		expect(response.status).toBe(200);
	});

	it('runs the scheduled tasks on a cron trigger', async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValue(new Response('{}', { status: 200 }));
		vi.stubGlobal('fetch', fetch);

		const pending: Promise<unknown>[] = [];
		const ctx = {
			waitUntil: (promise: Promise<unknown>) => pending.push(promise),
			passThroughOnException: () => {},
		} as unknown as ExecutionContext;

		worker.scheduled(
			{ cron: '*/15 * * * *', scheduledTime: Date.now(), noRetry: () => {} } as ScheduledController,
			env,
			ctx,
		);
		await Promise.all(pending);

		expect(fetch).toHaveBeenCalledWith('https://api.test/health', expect.anything());
	});
});

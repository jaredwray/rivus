import { describe, expect, it, vi } from 'vitest';
import { listTasks, runTask } from './tasks';
import type { Env } from './types';

const env: Env = { API_BASE_URL: 'https://api.test' };

describe('tasks', () => {
	it('lists the registered tasks', () => {
		expect(listTasks()).toEqual(expect.arrayContaining(['healthcheck', 'heartbeat']));
	});

	it('healthcheck reports ok when the API responds 200', async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValue(new Response('{}', { status: 200 }));
		const result = await runTask('healthcheck', { env, fetch });

		expect(result).toMatchObject({ task: 'healthcheck', ok: true });
		expect(result.detail).toContain('200');
		expect(fetch).toHaveBeenCalledWith('https://api.test/health', expect.anything());
	});

	it('healthcheck reports not-ok on a 500', async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValue(new Response('boom', { status: 500 }));
		const result = await runTask('healthcheck', { env, fetch });

		expect(result.ok).toBe(false);
		expect(result.detail).toContain('500');
	});

	it('healthcheck handles a network error gracefully', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('ECONNREFUSED'));
		const result = await runTask('healthcheck', { env, fetch });

		expect(result.ok).toBe(false);
		expect(result.detail).toBe('ECONNREFUSED');
	});

	it('heartbeat always succeeds without touching the network', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>();
		const result = await runTask('heartbeat', { env, fetch });

		expect(result.ok).toBe(true);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('throws on an unknown task', async () => {
		await expect(runTask('nope', { env, fetch: vi.fn<typeof globalThis.fetch>() })).rejects.toThrow(
			/Unknown task/,
		);
	});
});

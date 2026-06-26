import { describe, expect, it, vi } from 'vitest';
import { AgentError, createAgentClient } from './client';

const ENDPOINT = 'https://agent.test/agents/rivus-agent/default';

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

describe('createAgentClient', () => {
	it('posts the conversation and returns the reply', async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValue(jsonResponse({ reply: 'Hello!' }));
		const client = createAgentClient(ENDPOINT, fetch);

		const result = await client.chat([{ role: 'user', content: 'hi' }]);

		expect(result).toEqual({ reply: 'Hello!' });
		expect(client.endpoint).toBe(ENDPOINT);
		expect(fetch).toHaveBeenCalledWith(
			ENDPOINT,
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
			}),
		);
	});

	it('throws a typed AgentError on a non-2xx response', async () => {
		// A fresh Response per call — a Response body can only be read once.
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockImplementation(async () => jsonResponse({ error: 'boom' }, 500));
		const client = createAgentClient(ENDPOINT, fetch);

		await expect(client.chat([])).rejects.toBeInstanceOf(AgentError);
		await expect(client.chat([])).rejects.toMatchObject({ status: 500 });
	});

	it('rejects when the reply does not match the expected shape', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse({ notReply: 1 }));
		const client = createAgentClient(ENDPOINT, fetch);

		await expect(client.chat([])).rejects.toThrow();
	});
});

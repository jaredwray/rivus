import { describe, expect, it } from 'vitest';
import { GREETING } from './conversation';
import {
	corsHeaders,
	handleChat,
	handlePublicRoute,
	jsonResponse,
	notFoundResponse,
	parseMessages,
} from './http';

function request(path: string, init?: RequestInit): Request {
	return new Request(`https://agent.test${path}`, init);
}

function postJson(body: unknown): Request {
	return request('/agents/rivus-agent/default', {
		method: 'POST',
		headers: { 'content-type': 'application/json', Origin: 'https://app.rivus.ai' },
		body: JSON.stringify(body),
	});
}

describe('parseMessages', () => {
	it('returns [] for non-object bodies', () => {
		expect(parseMessages(null)).toEqual([]);
		expect(parseMessages('hello')).toEqual([]);
		expect(parseMessages(undefined)).toEqual([]);
	});

	it('expands the { message } shorthand into a single user turn', () => {
		expect(parseMessages({ message: 'hi' })).toEqual([{ role: 'user', content: 'hi' }]);
	});

	it('parses a full { messages } transcript', () => {
		expect(parseMessages({ messages: [{ role: 'assistant', content: 'yo' }] })).toEqual([
			{ role: 'assistant', content: 'yo' },
		]);
	});

	it('defaults a message role to user', () => {
		expect(parseMessages({ messages: [{ content: 'no role' }] })).toEqual([
			{ role: 'user', content: 'no role' },
		]);
	});

	it('returns [] when messages is malformed', () => {
		expect(parseMessages({ messages: [{ role: 'user' }] })).toEqual([]);
		expect(parseMessages({ messages: 'nope' })).toEqual([]);
		expect(parseMessages({})).toEqual([]);
	});
});

describe('corsHeaders', () => {
	it('echoes the caller Origin', () => {
		expect(corsHeaders(postJson({}))['Access-Control-Allow-Origin']).toBe('https://app.rivus.ai');
	});

	it('falls back to * when there is no Origin', () => {
		expect(corsHeaders(request('/health'))['Access-Control-Allow-Origin']).toBe('*');
	});
});

describe('jsonResponse / notFoundResponse', () => {
	it('serializes the body with CORS + JSON headers', async () => {
		const response = jsonResponse({ ok: true }, request('/health'), 201);
		expect(response.status).toBe(201);
		expect(response.headers.get('content-type')).toBe('application/json');
		expect(response.headers.get('access-control-allow-origin')).toBe('*');
		expect(await response.json()).toEqual({ ok: true });
	});

	it('builds a 404 describing the missing route', async () => {
		const response = notFoundResponse(request('/nope'), '/nope');
		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ error: 'Not Found' });
	});
});

describe('handleChat', () => {
	it('answers a CORS preflight with 204 and no body', async () => {
		const response = await handleChat(
			request('/agents/rivus-agent/default', {
				method: 'OPTIONS',
				headers: { Origin: 'https://app.rivus.ai' },
			}),
		);
		expect(response.status).toBe(204);
		expect(response.headers.get('access-control-allow-methods')).toContain('POST');
	});

	it('greets on GET so it can be smoke-tested from a browser', async () => {
		const response = await handleChat(request('/agents/rivus-agent/default'));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ reply: GREETING });
	});

	it('replies with hello to a posted message', async () => {
		const response = await handleChat(postJson({ messages: [{ role: 'user', content: 'hi' }] }));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ reply: GREETING });
		expect(response.headers.get('access-control-allow-origin')).toBe('https://app.rivus.ai');
	});

	it('tolerates an empty or invalid POST body and still greets', async () => {
		const empty = await handleChat(request('/agents/rivus-agent/default', { method: 'POST' }));
		expect(await empty.json()).toEqual({ reply: GREETING });

		const garbage = await handleChat(
			request('/agents/rivus-agent/default', { method: 'POST', body: 'not json' }),
		);
		expect(await garbage.json()).toEqual({ reply: GREETING });
	});

	it('rejects other methods with 405', async () => {
		const response = await handleChat(request('/agents/rivus-agent/default', { method: 'DELETE' }));
		expect(response.status).toBe(405);
	});
});

describe('handlePublicRoute', () => {
	it('answers any OPTIONS preflight (including the agent path)', () => {
		const response = handlePublicRoute(
			request('/agents/rivus-agent/default', { method: 'OPTIONS' }),
		);
		expect(response?.status).toBe(204);
	});

	it('answers /health and / with ok', async () => {
		const health = handlePublicRoute(request('/health'));
		expect(health?.status).toBe(200);
		expect(await health?.json()).toMatchObject({ status: 'ok', agent: 'rivus' });

		expect(handlePublicRoute(request('/'))?.status).toBe(200);
	});

	it('returns null so agent routes fall through to the SDK router', () => {
		expect(handlePublicRoute(postJson({ message: 'hi' }))).toBeNull();
	});
});

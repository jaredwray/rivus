import { describe, expect, it, vi } from 'vitest';
import type { FetchLike } from './api';
import { GREETING } from './conversation';
import {
	corsHeaders,
	handleChat,
	handlePublicRoute,
	jsonResponse,
	notFoundResponse,
	parseMessages,
} from './http';
import type { Env } from './types';

const SECRET = 'test-secret-value-1234';
const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signToken(payload: Record<string, unknown>): Promise<string> {
	const seg = (value: unknown) => base64Url(encoder.encode(JSON.stringify(value)));
	const data = `${seg({ alg: 'HS256', typ: 'JWT' })}.${seg(payload)}`;
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(SECRET),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
	return `${data}.${base64Url(signature)}`;
}

function request(path: string, init?: RequestInit): Request {
	return new Request(`https://agent.test${path}`, init);
}

function postJson(body: unknown, init?: RequestInit): Request {
	return request('/agents/rivus-agent/default', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			Origin: 'https://app.rivus.ai',
			...init?.headers,
		},
		body: JSON.stringify(body),
		...init,
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
	it('echoes an allowed Origin and allows credentials', () => {
		const headers = corsHeaders(postJson({}));
		expect(headers['Access-Control-Allow-Origin']).toBe('https://app.rivus.ai');
		expect(headers['Access-Control-Allow-Credentials']).toBe('true');
		expect(headers['Access-Control-Allow-Headers']).toContain('Authorization');
	});

	it('falls back to a plain wildcard when there is no Origin', () => {
		const headers = corsHeaders(request('/health'));
		expect(headers['Access-Control-Allow-Origin']).toBe('*');
		expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
	});

	it('does not reflect an Origin that is not on the allowlist', () => {
		const env = { ALLOWED_ORIGINS: 'https://app.rivus.ai' } as Env;
		const headers = corsHeaders(
			request('/x', { headers: { Origin: 'https://evil.example' } }),
			env,
		);
		expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
	});

	it('reflects an explicitly allowlisted Origin', () => {
		const env = { ALLOWED_ORIGINS: 'https://app.rivus.ai,https://www.rivus.ai' } as Env;
		const headers = corsHeaders(
			request('/x', { headers: { Origin: 'https://www.rivus.ai' } }),
			env,
		);
		expect(headers['Access-Control-Allow-Origin']).toBe('https://www.rivus.ai');
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
	it('answers a CORS preflight with 204 allowing POST and Authorization', async () => {
		const response = await handleChat(
			request('/agents/rivus-agent/default', {
				method: 'OPTIONS',
				headers: { Origin: 'https://app.rivus.ai' },
			}),
		);
		expect(response.status).toBe(204);
		expect(response.headers.get('access-control-allow-methods')).toContain('POST');
		expect(response.headers.get('access-control-allow-headers')).toContain('Authorization');
	});

	it('greets on GET so it can be smoke-tested from a browser', async () => {
		const response = await handleChat(request('/agents/rivus-agent/default'));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ reply: GREETING });
	});

	it('greets and nudges an unauthenticated POST to sign in', async () => {
		const response = await handleChat(postJson({ messages: [{ role: 'user', content: 'hi' }] }));
		expect(response.status).toBe(200);
		const body = (await response.json()) as { reply: string };
		expect(body.reply).toContain(GREETING);
		expect(body.reply).toMatch(/sign in/i);
		expect(response.headers.get('access-control-allow-origin')).toBe('https://app.rivus.ai');
	});

	it('tolerates an empty or invalid POST body and still greets', async () => {
		const empty = await handleChat(request('/agents/rivus-agent/default', { method: 'POST' }));
		expect(((await empty.json()) as { reply: string }).reply).toContain(GREETING);

		const garbage = await handleChat(
			request('/agents/rivus-agent/default', { method: 'POST', body: 'not json' }),
		);
		expect(((await garbage.json()) as { reply: string }).reply).toContain(GREETING);
	});

	it('serves an authenticated request from the user’s Rivus data', async () => {
		const token = await signToken({
			sub: 'user_1',
			email: 'owner@acme.example',
			accountId: 'acct_1',
			role: 'owner',
			exp: Math.floor(Date.now() / 1000) + 3600,
		});
		const account = {
			id: 'acct_1',
			name: 'Acme',
			slug: 'acme',
			phone: '',
			address: '',
			website: 'https://acme.example',
			timezone: 'UTC',
			status: 'active',
			canceledAt: null,
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
		};
		const fetchImpl = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						user: {
							id: 'user_1',
							email: 'owner@acme.example',
							name: 'Pat',
							createdAt: account.createdAt,
							updatedAt: account.updatedAt,
						},
						account,
						role: 'owner',
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				),
		) as unknown as FetchLike;

		const env = { JWT_SECRET: SECRET, RIVUS_API_URL: 'https://api.test' } as unknown as Env;
		const response = await handleChat(
			postJson(
				{ messages: [{ role: 'user', content: 'what is our website?' }] },
				{ headers: { Authorization: `Bearer ${token}` } },
			),
			env,
			fetchImpl,
		);

		expect(response.status).toBe(200);
		expect(((await response.json()) as { reply: string }).reply).toBe(
			'Your website is https://acme.example.',
		);
		expect(fetchImpl).toHaveBeenCalledWith(
			'https://api.test/v1/auth/me',
			expect.objectContaining({ method: 'GET' }),
		);
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

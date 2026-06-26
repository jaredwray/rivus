import { z } from 'zod';
import { replyTo } from './conversation';
import type { ChatMessage } from './types';

// The app posts either a full `{ messages: [...] }` transcript or a shorthand
// `{ message: "hi" }`. Both are tolerated; anything unparseable degrades to an
// empty conversation (Rivus still greets) rather than erroring.
const chatMessageSchema = z.object({
	role: z.enum(['user', 'assistant', 'system']).default('user'),
	content: z.string(),
});

/**
 * Coerce an arbitrary request body into a list of chat messages. Never throws —
 * a malformed body yields `[]`, so the agent always has something safe to reply
 * to.
 */
export function parseMessages(body: unknown): ChatMessage[] {
	if (typeof body !== 'object' || body === null) {
		return [];
	}
	const record = body as Record<string, unknown>;
	if (typeof record.message === 'string') {
		return [{ role: 'user', content: record.message }];
	}
	const parsed = z.array(chatMessageSchema).safeParse(record.messages);
	return parsed.success ? parsed.data : [];
}

/**
 * CORS headers for the agent. The app is served from a different origin
 * (e.g. the Expo web bundle on app.rivus.ai, or localhost during dev), so the
 * browser requires these on every response and on the preflight. We echo the
 * caller's `Origin` because this is a public greeting endpoint.
 */
export function corsHeaders(request: Request): Record<string, string> {
	return {
		'Access-Control-Allow-Origin': request.headers.get('Origin') ?? '*',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
		'Access-Control-Max-Age': '86400',
		Vary: 'Origin',
	};
}

/** JSON response carrying the CORS headers. */
export function jsonResponse(body: unknown, request: Request, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', ...corsHeaders(request) },
	});
}

/** Empty 204 answer to a browser CORS preflight. */
export function corsPreflight(request: Request): Response {
	return new Response(null, { status: 204, headers: corsHeaders(request) });
}

/** Liveness probe payload. */
export function healthResponse(request: Request): Response {
	return jsonResponse({ status: 'ok', agent: 'rivus' }, request);
}

/** A 404 for an unmatched route. */
export function notFoundResponse(request: Request, pathname: string): Response {
	return jsonResponse(
		{ error: 'Not Found', message: `No route for ${request.method} ${pathname}` },
		request,
		404,
	);
}

/** Parse a request body as JSON, tolerating an empty or invalid body. */
async function readJson(request: Request): Promise<unknown> {
	try {
		const text = await request.text();
		return text.length > 0 ? JSON.parse(text) : {};
	} catch {
		return {};
	}
}

/**
 * Handle a chat request to a Rivus agent instance. This is what the Durable
 * Object's `onRequest` delegates to, and it is pure (request in, response out)
 * so it is unit-tested under Node without the Workers runtime.
 *
 * - `GET` returns the greeting, which makes the endpoint a friendly smoke test
 *   you can hit straight from a browser.
 * - `POST` replies to the supplied conversation.
 * - `OPTIONS` answers the CORS preflight.
 */
export async function handleChat(request: Request): Promise<Response> {
	if (request.method === 'OPTIONS') {
		return corsPreflight(request);
	}
	if (request.method === 'GET') {
		return jsonResponse(replyTo([]), request);
	}
	if (request.method !== 'POST') {
		return jsonResponse({ error: 'Method Not Allowed', message: 'Use POST to chat' }, request, 405);
	}
	const messages = parseMessages(await readJson(request));
	return jsonResponse(replyTo(messages), request);
}

/**
 * Routes the Worker entrypoint can answer without touching a Durable Object:
 * the CORS preflight (for any path, including the agent path) plus the health
 * and root probes. Returns `null` when the request should fall through to the
 * Agents SDK router. Pure, so `index.ts` stays a thin adapter.
 */
export function handlePublicRoute(request: Request): Response | null {
	if (request.method === 'OPTIONS') {
		return corsPreflight(request);
	}
	const { pathname } = new URL(request.url);
	if (pathname === '/health' || pathname === '/') {
		return healthResponse(request);
	}
	return null;
}

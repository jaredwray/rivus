import { z } from 'zod';
import { respond } from './assistant';
import { replyTo } from './conversation';
import type { ChatMessage, Env } from './types';

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

/** Match an origin against one allowlist entry, supporting a single-label `*`. */
function matchesOrigin(origin: string, pattern: string): boolean {
	if (!pattern.includes('*')) {
		return origin === pattern;
	}
	// Escape regex metachars, then turn `*` into a single-label wildcard so
	// `https://*.rivus.ai` matches `app.rivus.ai` but not `a.b.rivus.ai` — the same
	// rule the API's `parseCorsOrigin` uses.
	const escaped = pattern.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '[^.]+');
	return new RegExp(`^${escaped}$`).test(origin);
}

/**
 * Whether a browser `Origin` may make credentialed requests to the agent.
 *
 * Credentialed CORS can't safely reflect a bare `*` — that would let any site
 * make authenticated cross-origin requests and read a signed-in user's replies.
 * So a bare `*` is refused in production (mirroring the API's boot-time guard);
 * locally it reflects any origin for convenience. Deployed environments must list
 * exact origins, or a single-label subdomain wildcard like `https://*.rivus.ai`.
 */
function originAllowed(origin: string, allowed: string | undefined, nodeEnv?: string): boolean {
	const list = (allowed ?? '*')
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
	if (list.includes('*')) {
		if (nodeEnv === 'production') {
			throw new Error(
				"ALLOWED_ORIGINS must be an explicit origin allowlist in production, not '*': credentialed CORS reflects the request origin, so a wildcard would authorize every site.",
			);
		}
		return true;
	}
	return list.some((pattern) => matchesOrigin(origin, pattern));
}

/**
 * CORS headers for the agent. The app is served from a different origin
 * (e.g. app.rivus.ai, or localhost during dev), so the browser requires these on
 * every response and on the preflight.
 *
 * Authenticated requests carry the session cookie, which means credentialed CORS:
 * we must echo the *specific* allowed origin (never `*`) and set
 * `Allow-Credentials`. `ALLOWED_ORIGINS` is the allowlist; a bare `*` (the dev
 * default) reflects any origin but only for unauthenticated use, and a request
 * with no `Origin` (curl / the native app) gets a plain wildcard with no
 * credentials. `Authorization` is allowed so native clients can send the bearer
 * token.
 */
export function corsHeaders(request: Request, env?: Env): Record<string, string> {
	const base: Record<string, string> = {
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		'Access-Control-Max-Age': '86400',
	};
	const origin = request.headers.get('Origin');
	if (origin && originAllowed(origin, env?.ALLOWED_ORIGINS, env?.NODE_ENV)) {
		return {
			...base,
			'Access-Control-Allow-Origin': origin,
			'Access-Control-Allow-Credentials': 'true',
			Vary: 'Origin',
		};
	}
	if (!origin) {
		// No browser origin (curl / native bearer client): a plain public wildcard.
		return { ...base, 'Access-Control-Allow-Origin': '*' };
	}
	// A browser origin that isn't on the allowlist: omit `Allow-Origin` so the
	// browser blocks the response rather than us reflecting an untrusted origin.
	return { ...base, Vary: 'Origin' };
}

/** JSON response carrying the CORS headers. */
export function jsonResponse(body: unknown, request: Request, status = 200, env?: Env): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', ...corsHeaders(request, env) },
	});
}

/** Empty 204 answer to a browser CORS preflight. */
export function corsPreflight(request: Request, env?: Env): Response {
	return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

/** Liveness probe payload. */
export function healthResponse(request: Request, env?: Env): Response {
	return jsonResponse({ status: 'ok', agent: 'rivus' }, request, 200, env);
}

/** A 404 for an unmatched route. */
export function notFoundResponse(request: Request, pathname: string, env?: Env): Response {
	return jsonResponse(
		{ error: 'Not Found', message: `No route for ${request.method} ${pathname}` },
		request,
		404,
		env,
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
 * Object's `onRequest` delegates to, and it is pure (request + env in, response
 * out) so it is unit-tested under Node without the Workers runtime.
 *
 * - `GET` returns the greeting, which makes the endpoint a friendly smoke test
 *   you can hit straight from a browser (no auth required).
 * - `POST` replies to the supplied conversation. When the request carries a valid
 *   session (bearer token or `rivus_session` cookie) the reply can draw on the
 *   user's company and knowledge base; otherwise Rivus nudges them to sign in.
 * - `OPTIONS` answers the CORS preflight.
 */
export async function handleChat(
	request: Request,
	env?: Env,
	fetchImpl?: typeof globalThis.fetch,
): Promise<Response> {
	if (request.method === 'OPTIONS') {
		return corsPreflight(request, env);
	}
	if (request.method === 'GET') {
		return jsonResponse(replyTo([]), request, 200, env);
	}
	if (request.method !== 'POST') {
		return jsonResponse(
			{ error: 'Method Not Allowed', message: 'Use POST to chat' },
			request,
			405,
			env,
		);
	}
	const messages = parseMessages(await readJson(request));
	const reply = await respond({ env: env ?? ({} as Env), request, messages, fetchImpl });
	return jsonResponse({ reply }, request, 200, env);
}

/**
 * Routes the Worker entrypoint can answer without touching a Durable Object:
 * the CORS preflight (for any path, including the agent path) plus the health
 * and root probes. Returns `null` when the request should fall through to the
 * Agents SDK router. Pure, so `index.ts` stays a thin adapter.
 */
export function handlePublicRoute(request: Request, env?: Env): Response | null {
	if (request.method === 'OPTIONS') {
		return corsPreflight(request, env);
	}
	const { pathname } = new URL(request.url);
	if (pathname === '/health' || pathname === '/') {
		return healthResponse(request, env);
	}
	return null;
}

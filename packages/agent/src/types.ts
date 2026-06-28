import type { AuthTokenPayload } from '@rivus/core';

/** Bindings configured in wrangler.jsonc (and any secrets added at deploy time). */
export interface Env {
	/** The Rivus agent Durable Object namespace (see wrangler.jsonc). */
	RivusAgent: DurableObjectNamespace;
	/**
	 * Shared HS256 secret used to verify the session JWTs that `@rivus/api` issues.
	 * It must match the API's `JWT_SECRET` so a token signed by the API verifies
	 * here. Set as a Worker secret (`wrangler secret put JWT_SECRET`), never a
	 * plaintext var. When unset the agent simply treats every request as anonymous.
	 */
	JWT_SECRET?: string;
	/**
	 * Base URL of the Rivus REST API the agent calls on the signed-in user's behalf
	 * (e.g. `https://api.rivus.ai`). The agent forwards the user's token so the API
	 * stays the single authority for tenant data and permission checks.
	 */
	RIVUS_API_URL?: string;
	/**
	 * Comma-separated browser origins allowed to make credentialed (cookie-bearing)
	 * requests, e.g. `https://app.rivus.ai`. A bare `*` (the default, for local
	 * development) reflects any origin. Credentialed CORS can't use a wildcard, so
	 * production must list the app's exact origin — otherwise any site could read a
	 * signed-in user's agent replies.
	 */
	ALLOWED_ORIGINS?: string;
	/**
	 * Deployment mode (`production` | `development`). In `production` a wildcard
	 * `ALLOWED_ORIGINS` is refused so credentialed CORS can never reflect an
	 * arbitrary origin — mirroring the API's boot-time guard. Set per environment
	 * in wrangler.jsonc; unset locally (treated as development).
	 */
	NODE_ENV?: string;
	/**
	 * Anthropic API key used to route the agent — i.e. to let the model decide which
	 * of the agent's tools (company facts, knowledge-base search/answer/edits) the
	 * latest message calls for. A deploy-time secret (`wrangler secret put
	 * ANTHROPIC_API_KEY`), never a plaintext var. When unset, routing degrades to the
	 * deterministic rule-based parser, so the agent still works without a model.
	 */
	ANTHROPIC_API_KEY?: string;
	/**
	 * The model used for routing, e.g. `claude-haiku-4-5` (small and fast — it only
	 * picks an action, it doesn't write the reply). Set per environment in
	 * wrangler.jsonc; defaults to a fast model when unset.
	 */
	ANTHROPIC_MODEL?: string;
}

/**
 * The claims carried by a verified Rivus session JWT — the same payload
 * `@rivus/api` signs at sign-in (`sub`, `email`, `accountId`, `role`). Reused
 * here so the agent and API agree on exactly what a session means.
 */
export type SessionClaims = AuthTokenPayload;

/** A single chat turn. Mirrors the shape the app's agent client sends. */
export interface ChatMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
}

/** The agent's response to a chat request. */
export interface ChatReply {
	reply: string;
}

/**
 * Persistent per-conversation state held by the Agent Durable Object. The first
 * milestone only counts the messages it has seen, proving the instance is a
 * stateful, addressable agent rather than a stateless function.
 */
export interface RivusAgentState {
	messagesSeen: number;
}

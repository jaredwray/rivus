import { z } from 'zod';
import { getAgentEndpoint } from './config';

/**
 * Pure, runtime-agnostic client for the Rivus agent service. Like the API
 * client, it imports nothing from `react-native`/`expo`, so it runs under plain
 * Node and is unit-tested with a mocked `fetch`.
 */

/** A single chat turn exchanged with the agent. */
export interface ChatMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
}

// The agent answers with a single reply string (see `@rivus/agent`).
const chatReplySchema = z.object({ reply: z.string() });
export type ChatReply = z.infer<typeof chatReplySchema>;

/** Error thrown for any non-2xx response, carrying the HTTP status. */
export class AgentError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = 'AgentError';
		this.status = status;
	}
}

export type FetchLike = typeof globalThis.fetch;

export interface RivusAgentClient {
	/** The absolute endpoint this client posts to. */
	readonly endpoint: string;
	/**
	 * Send a conversation and resolve the agent's reply. When the user is signed
	 * in, pass their session `token` (native) so the agent can act on their behalf;
	 * web clients leave it empty and rely on the `rivus_session` cookie instead
	 * (see `withCredentials`).
	 */
	chat(messages: ChatMessage[], token?: string): Promise<ChatReply>;
}

/** Optional knobs for {@link createAgentClient}. */
export interface AgentClientOptions {
	/**
	 * Send cookies with every request (`credentials: 'include'`). Web clients use
	 * this so the API's HttpOnly `rivus_session` cookie rides along to the agent —
	 * the same mechanism the API client uses. Native clients leave it off and
	 * authenticate with the bearer token passed to `chat`.
	 */
	withCredentials?: boolean;
}

export function createAgentClient(
	endpoint: string = getAgentEndpoint(),
	fetchImpl: FetchLike = fetch,
	options: AgentClientOptions = {},
): RivusAgentClient {
	const credentials: RequestCredentials | undefined = options.withCredentials
		? 'include'
		: undefined;

	return {
		endpoint,

		async chat(messages: ChatMessage[], token?: string): Promise<ChatReply> {
			const headers: Record<string, string> = { 'Content-Type': 'application/json' };
			// Only attach a bearer header when there's actually a token. In web cookie
			// mode the token is empty; sending `Authorization: Bearer ` (malformed) would
			// stop the agent from falling back to the session cookie.
			if (token) {
				headers.Authorization = `Bearer ${token}`;
			}
			const response = await fetchImpl(endpoint, {
				method: 'POST',
				headers,
				body: JSON.stringify({ messages }),
				...(credentials ? { credentials } : {}),
			});

			const raw = await response.text();
			const body = raw.length > 0 ? safeJsonParse(raw) : undefined;

			if (!response.ok) {
				throw new AgentError(
					`Rivus agent request failed with status ${response.status}`,
					response.status,
				);
			}

			return chatReplySchema.parse(body);
		},
	};
}

function safeJsonParse(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

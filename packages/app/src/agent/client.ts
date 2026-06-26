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
	/** Send a conversation and resolve the agent's reply. */
	chat(messages: ChatMessage[]): Promise<ChatReply>;
}

export function createAgentClient(
	endpoint: string = getAgentEndpoint(),
	fetchImpl: FetchLike = fetch,
): RivusAgentClient {
	return {
		endpoint,

		async chat(messages: ChatMessage[]): Promise<ChatReply> {
			const response = await fetchImpl(endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ messages }),
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

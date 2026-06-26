/** Bindings configured in wrangler.jsonc (and any secrets added at deploy time). */
export interface Env {
	/** The Rivus agent Durable Object namespace (see wrangler.jsonc). */
	RivusAgent: DurableObjectNamespace;
}

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

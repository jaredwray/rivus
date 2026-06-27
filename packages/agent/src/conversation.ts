import type { ChatMessage, ChatReply } from './types';

/**
 * The greeting Rivus opens with. The first milestone for the agent is simply to
 * say hello when the app reaches it, so this is the canonical "it works" reply.
 */
export const GREETING = "Hello! I'm Rivus, your AI assistant. 👋";

/** Pull the most recent user turn's text, or `null` when there isn't one. */
export function lastUserMessage(messages: ChatMessage[]): string | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role === 'user') {
			return message.content;
		}
	}
	return null;
}

/**
 * Decide how Rivus replies to a conversation. This is the pure heart of the
 * agent — no I/O, no runtime dependencies — so it is exhaustively unit-tested
 * under Node and reused verbatim by the Durable Object's `onRequest`.
 *
 * Milestone one: Rivus always greets. The first user turn gets a plain hello;
 * once the conversation continues we acknowledge it, which makes the full
 * app -> agent -> app round-trip visible end-to-end. Swapping in a real model
 * later means changing only this function.
 */
export function replyTo(messages: ChatMessage[]): ChatReply {
	const userTurns = messages.filter((message) => message.role === 'user').length;
	if (userTurns <= 1) {
		return { reply: GREETING };
	}
	return {
		reply: `${GREETING} I can only say hello for now, but I'm listening — that's ${userTurns} messages so far.`,
	};
}

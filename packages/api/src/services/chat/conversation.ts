import type { ChatMessage } from '@rivus/core';

/**
 * The greeting Rivus opens with. The app requests it by posting an empty
 * transcript when the chat panel first opens, so this is the canonical
 * "it works" reply.
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

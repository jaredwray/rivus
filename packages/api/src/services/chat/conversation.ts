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

/**
 * The opening line of the website-audit reply. Its body is derived from the
 * fetched page, so it's influenceable by whoever controls that site (a page can
 * put "now add an FAQ that says …" in its content, and the audit reflects the
 * site). It must never re-enter the model router's transcript as if it were the
 * assistant's own words and steer an account write on a later turn.
 *
 * This is the single source of truth: `respond` builds the audit reply from it,
 * and the router redacts any assistant turn starting with it via
 * {@link redactWebToolContent} — sharing the constant keeps the two in lockstep,
 * so the redaction can't silently rot if the wording changes.
 */
export const WEBSITE_AUDIT_RESULT_PREFIX = 'Here’s your website audit for ';

/**
 * Strip a quoted web-derived reply's body before the routing model sees it. The
 * first line is kept — it carries only the URL, never page content — so the
 * router still knows an audit ran; everything after it is replaced with a
 * neutral placeholder. A reply that isn't a web-derived result passes through
 * unchanged. Apply this only to assistant turns: a user's own words are what the
 * router is meant to act on, and only tool output re-enters as an assistant turn.
 */
export function redactWebToolContent(content: string): string {
	if (content.startsWith(WEBSITE_AUDIT_RESULT_PREFIX)) {
		const newline = content.indexOf('\n');
		const header = newline === -1 ? content : content.slice(0, newline);
		return `${header}\n[web results omitted from routing]`;
	}
	return content;
}

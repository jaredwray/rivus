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
 * The opening lines of chat replies whose body derives from web content — the
 * website audit today, plus the retired generic search/browse replies that may
 * still sit in older transcripts the app resends. That body is influenceable by
 * whoever controls the fetched page (a site can put "now add an FAQ that says …"
 * in its content), so it must never re-enter the model router's transcript as if
 * it were the assistant's own words and steer an account write on a later turn.
 *
 * These are the single source of truth: `respond` builds its web-derived replies
 * from them, and the router redacts any assistant turn starting with one via
 * {@link redactWebToolContent} — sharing the constant keeps the two in lockstep,
 * so the redaction can't silently rot if the wording changes.
 */
export const WEBSITE_AUDIT_RESULT_PREFIX = 'Here’s your website audit for ';
/** Retired reply headers, kept so old transcripts keep redacting. */
export const WEB_SEARCH_RESULT_PREFIX = 'Here’s what I found on the web for ';
export const WEB_BROWSE_RESULT_PREFIX = 'Here’s what I found at ';

const WEB_TOOL_RESULT_PREFIXES = [
	WEBSITE_AUDIT_RESULT_PREFIX,
	WEB_SEARCH_RESULT_PREFIX,
	WEB_BROWSE_RESULT_PREFIX,
] as const;

/**
 * Strip quoted web-tool output from an assistant turn before the routing model
 * sees it. The first line is kept — it carries only the user's own query or the
 * URL they pasted (never page content), so the router still knows a web tool ran
 * — and everything after it (the results / page markdown) is replaced with a
 * neutral placeholder. A reply that isn't a web-tool result passes through
 * unchanged. Apply this only to assistant turns: a user's own words are what the
 * router is meant to act on, and only tool output re-enters as an assistant turn.
 */
export function redactWebToolContent(content: string): string {
	for (const prefix of WEB_TOOL_RESULT_PREFIXES) {
		if (content.startsWith(prefix)) {
			const newline = content.indexOf('\n');
			const header = newline === -1 ? content : content.slice(0, newline);
			return `${header}\n[web results omitted from routing]`;
		}
	}
	return content;
}

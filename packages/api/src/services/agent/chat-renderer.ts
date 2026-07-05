import type { ChannelCapabilities } from './channel';
import { type AgentResponse, renderResponseText } from './response';

/**
 * The chat-family generic renderer (WhatsApp and SMS): any
 * {@link AgentResponse} → one plain-text message. It leans on the neutral
 * `renderResponseText`, which already flattens an `options` block to a numbered
 * list and an `action` block to a URL line, so it needs no per-decision logic —
 * a new core feature renders here unchanged. `maxTextLength` is honored so the
 * same renderer serves length-capped channels (SMS) without change.
 *
 * v1 ships text-only (`supportsInteractiveOptions: false`); when zernio's
 * interactive quick-reply support is confirmed, mapping `options` to native
 * buttons is a rendering-only change here — no feature or channel edits.
 */
export function renderChatResponse(response: AgentResponse, caps: ChannelCapabilities): string {
	const text = renderResponseText(response);
	if (caps.maxTextLength !== null && text.length > caps.maxTextLength) {
		return `${text.slice(0, Math.max(0, caps.maxTextLength - 1))}…`;
	}
	return text;
}

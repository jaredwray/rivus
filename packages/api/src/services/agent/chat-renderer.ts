import type { ChannelCapabilities } from './channel';
import type { AgentResponse, AgentResponseBlock } from './response';
import { renderResponseText } from './response';

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

/**
 * How short a line of prose may be squeezed before shortening it further stops
 * being worth it. Below this a truncated sentence carries no meaning, so the
 * budget is taken from the next-longest line instead.
 */
const MIN_PROSE_CHARS = 40;

/** The blocks that carry free prose — the only ones the budget may shorten. */
type ProseBlock = Extract<AgentResponseBlock, { kind: 'paragraph' | 'freeText' }>;

function isProse(block: AgentResponseBlock): block is ProseBlock {
	return block.kind === 'paragraph' || block.kind === 'freeText';
}

/** Cap a line at `max`, marking the cut with an ellipsis. */
function ellipsize(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * Fit a response into `limit` characters by shortening PROSE only.
 *
 * A tail truncation of the flattened message drops whichever blocks happen to
 * come last — so an over-long answer silently costs the contact the numbered
 * options or the signup link, while the thread advances as though they had been
 * given them. The actionable blocks are also the short ones, so the space is
 * taken out of the prose instead: longest line first (a paragraph may carry
 * internal newlines, and each line is shortened on its own, so a long answer is
 * trimmed before the sentence that follows it) and never below a readable floor.
 *
 * Purely presentational and feature-blind — it branches on block KIND, never on
 * what the agent decided.
 */
function fitWithinBudget(response: AgentResponse, limit: number): AgentResponse {
	// One mutable line buffer per block; null for blocks that must survive whole.
	const buffers = response.blocks.map((block) => (isProse(block) ? block.text.split('\n') : null));
	const compose = (): AgentResponse => ({
		blocks: response.blocks.map((block, index) => {
			const lines = buffers[index];
			return lines && isProse(block) ? { ...block, text: lines.join('\n') } : block;
		}),
	});

	let rendered = renderResponseText(compose());
	while (rendered.length > limit) {
		// The longest line still above the floor, anywhere in the response.
		let pick: { block: number; line: number; length: number } | undefined;
		for (const [block, lines] of buffers.entries()) {
			for (const [line, text] of (lines ?? []).entries()) {
				if (text.length > MIN_PROSE_CHARS && (!pick || text.length > pick.length)) {
					pick = { block, line, length: text.length };
				}
			}
		}
		// Everything shrinkable is already at the floor — the caller falls back.
		if (!pick) {
			break;
		}
		const lines = buffers[pick.block];
		if (!lines) {
			break;
		}
		const overflow = rendered.length - limit;
		lines[pick.line] = ellipsize(
			lines[pick.line] ?? '',
			Math.max(MIN_PROSE_CHARS, pick.length - overflow),
		);
		rendered = renderResponseText(compose());
	}
	return compose();
}

export function renderChatResponse(response: AgentResponse, caps: ChannelCapabilities): string {
	const text = renderResponseText(response);
	if (caps.maxTextLength === null || text.length <= caps.maxTextLength) {
		return text;
	}
	const fitted = renderResponseText(fitWithinBudget(response, caps.maxTextLength));
	if (fitted.length <= caps.maxTextLength) {
		return fitted;
	}
	// Pathological (a wall of options, or prose already at the floor): the hard
	// channel limit still has to be honored, so fall back to a tail cut.
	return `${fitted.slice(0, Math.max(0, caps.maxTextLength - 1))}…`;
}

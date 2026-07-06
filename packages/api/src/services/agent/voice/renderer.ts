import type { AgentResponse, AgentResponseBlock } from '../response';

/**
 * The voice renderer: any {@link AgentResponse} → one spoken utterance for a
 * `<Speak>` element. Where the chat renderer keeps line structure, speech wants
 * flowing sentences: options become "Option 1: …", the action link becomes a
 * read-out web address (protocol and query stripped — nobody dictates
 * `?email=…`), and newlines become sentence breaks. XML escaping is the XML
 * layer's job, not this renderer's.
 */

/** A URL as a human would read it out: no scheme, no query, no trailing slash. */
function spokenUrl(url: string): string {
	const withoutScheme = url.replace(/^https?:\/\//, '');
	const withoutQuery = withoutScheme.split('?', 1)[0] ?? '';
	return withoutQuery.replace(/\/+$/, '');
}

/** Newlines → sentence-ish breaks, so multi-line paragraphs read naturally. */
function flowing(text: string): string {
	return text
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '')
		.join(' ');
}

function blockSpeech(block: AgentResponseBlock): string {
	switch (block.kind) {
		case 'greeting':
		case 'paragraph':
		case 'notice':
		case 'freeText':
			return flowing(block.text);
		case 'options':
			return block.items.map((item) => `Option ${item.value}: ${item.label}.`).join(' ');
		case 'action':
			return `${block.label}: ${spokenUrl(block.url)}.`;
	}
}

export function renderVoiceResponse(response: AgentResponse): string {
	return response.blocks
		.map(blockSpeech)
		.filter((speech) => speech !== '')
		.join(' ');
}

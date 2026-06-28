/**
 * Turn a user's message into a structured {@link Intent}. This is the pure,
 * deterministic "understanding" layer — no I/O, no model call — so it is
 * exhaustively unit-tested and reused verbatim by the agent's reply logic.
 *
 * It is intentionally rule-based: the agent answers a focused set of asks
 * (company facts + knowledge-base search/edits) where predictable, testable
 * routing beats an opaque classifier. Swapping in an LLM later means replacing
 * only this function — the orchestration in `assistant.ts` consumes the same
 * `Intent` shape.
 *
 * A single message is read on its own, but {@link resolveIntent} layers the
 * conversation on top: a follow-up that names no subject ("what should I add?")
 * inherits the topic the chat is already on, so it's understood instead of being
 * brushed off.
 */

import { lastUserMessage } from './conversation';
import type { ChatMessage } from './types';

/** A field of the company/account record the user can ask about. */
export type CompanyField =
	| 'name'
	| 'website'
	| 'phone'
	| 'address'
	| 'timezone'
	| 'slug'
	| 'status';

export type Intent =
	| { kind: 'greeting' }
	| { kind: 'help' }
	/** Asking about the company. An empty `fields` means "everything". */
	| { kind: 'company_info'; fields: CompanyField[] }
	/** Browse the whole knowledge base. */
	| { kind: 'faq_list' }
	/** Search the knowledge base for `query`. */
	| { kind: 'faq_search'; query: string }
	/** Edit an FAQ identified by `topic`; `answer` is the new text, or null if unsaid. */
	| { kind: 'faq_update'; topic: string; answer: string | null }
	/** Add an FAQ; `question`/`answer` are null when the user didn't supply them. */
	| { kind: 'faq_create'; question: string | null; answer: string | null }
	/**
	 * Answer a free-text question from the knowledge base (AI-assisted, via the API).
	 * The rule-based parser never produces this — it routes general questions through
	 * `unknown` — but a model router can pick it explicitly. The assistant handles
	 * both the same way.
	 */
	| { kind: 'faq_answer'; question: string }
	| { kind: 'unknown' };

/** The subject a conversation is on, carried forward to resolve bare follow-ups. */
export type ConversationTopic = 'faq' | 'company';

/**
 * What earlier turns established, so a message that names no subject of its own
 * can still be understood. Only `'faq'` currently changes parsing — it lets a
 * follow-up like "what should I add?" be read as a knowledge-base ask; `'company'`
 * is tracked for symmetry and future use.
 */
export interface IntentContext {
	topic?: ConversationTopic;
}

/** Keywords that put a message in "knowledge base" context. */
const FAQ_CONTEXT = /\b(faqs?|knowledge[ -]?base|knowledge)\b/;
const GREETING = /^(hi|hey|hello|yo|hiya|howdy|greetings|good (morning|afternoon|evening))\b/;
const HELP = /\b(help|what can you do|what do you do|how can you help|what can you help with)\b/;

/** Per-field keyword probes, checked to build the requested company `fields`. */
const COMPANY_FIELD_PATTERNS: ReadonlyArray<readonly [CompanyField, RegExp]> = [
	['website', /\b(website|web site|web address|url|homepage|home page|domain|site)\b/],
	['phone', /\b(phone|telephone|phone number)\b/],
	['address', /\b(address|location|street)\b/],
	['timezone', /\b(time ?zone)\b/],
	['name', /\b(business name|company name|name of (my|our|the) (company|business))\b/],
	['slug', /\b(slug|handle)\b/],
	['status', /\b(account status|subscription|plan)\b/],
];

/** Generic references to "the company" that mean "tell me everything". */
const COMPANY_GENERIC =
	/\b(company|business|account|my (info|information|details)|our (info|information|details)|about (my|our|the) (company|business)|profile)\b/;

const UPDATE_VERB = /\b(update|change|edit|revise|modify|fix)\b/;
const CREATE_VERB = /\b(add|create|new|make|insert)\b/;
const LIST_VERB = /\b(list|show|view|see|browse|all (of )?(my|our|the)?)\b/;
const SEARCH_VERB = /\b(search|find|look ?up|lookup|do we have|is there|tell me about)\b/;

/** Strip a leading article so an extracted topic reads cleanly. */
function trimTopic(value: string): string {
	return value
		.trim()
		.replace(/^(the|an|a|our|my)\s+/i, '')
		.replace(/[?.!]+$/, '')
		.trim();
}

/** Pull the phrase after the first "about/for/on/regarding", if any. */
function afterPreposition(text: string): string | null {
	const match = /\b(?:about|regarding|related to|on the topic of|for|on)\s+(.+)$/i.exec(text);
	return match?.[1] ? trimTopic(match[1]) : null;
}

/** A search query for an FAQ ask: the topic phrase, else the message minus FAQ/verb noise. */
function extractSearchQuery(text: string): string {
	const after = afterPreposition(text);
	if (after) {
		return after;
	}
	const stripped = text
		.replace(/\b(search|find|look ?up|lookup|for|in|the|our|my)\b/gi, ' ')
		// Global flag: strip every FAQ/knowledge term, e.g. both words in
		// "FAQs … knowledge base", so neither leaks into the query.
		.replace(new RegExp(FAQ_CONTEXT.source, 'gi'), ' ')
		.replace(/[?.!]+$/, '')
		.replace(/\s+/g, ' ')
		.trim();
	return stripped;
}

/** Parse an FAQ-edit ask into its topic and (optional) replacement answer. */
function parseFaqUpdate(text: string): { topic: string; answer: string | null } {
	// Prefer an explicit connector ("to say"/"to read"/"so it says") — it's
	// unambiguous, so a lazy topic is safe.
	const explicit =
		/\b(?:about|regarding|for|on)\s+(.+?)\s+(?:to say|to read|so (?:that )?it (?:says|reads))\s+(.+)$/i.exec(
			text,
		);
	if (explicit?.[1] && explicit[2]) {
		return { topic: trimTopic(explicit[1]), answer: explicit[2].trim().replace(/[?.!]+$/, '') };
	}
	// Bare "to" connector. Use a *greedy* topic so a multi-word topic that itself
	// contains "to" (e.g. "how to cancel") splits at the LAST " to ", not the first.
	const bare = /\b(?:about|regarding|for|on)\s+(.+)\s+to\s+(.+)$/i.exec(text);
	if (bare?.[1] && bare[2]) {
		return { topic: trimTopic(bare[1]), answer: bare[2].trim().replace(/[?.!]+$/, '') };
	}
	// Just a topic: "update the FAQ about <topic>" — we'll ask what to change.
	const topic = afterPreposition(text);
	return { topic: topic ?? '', answer: null };
}

/**
 * A double-quoted phrase used as the FAQ's title/question, e.g.
 * `add this FAQ. "Our Cancelation Policy". …`. Only *double* quotes (straight,
 * curly, or German low-high „…“) delimit a title — single quotes/apostrophes are
 * left alone so words like "don't" or "policy's" never look like an opening
 * quote. Note U+201C (“) is both the English opening and the German closing
 * quote, so it appears in both the opening and closing classes.
 */
const QUOTED_TITLE = /["“„]([^"“”„]+)["”“]/;

/** The FAQ noun a create command names, plus optional separators that follow it. */
const FAQ_COMMAND =
	/(?:add|create|new|make|insert)\b[^?]*?\b(?:faqs?|knowledge[ -]?base|kb)\b[\s:,.-]*/i;

/**
 * The FAQ "payload" — the text after the `add … faq` command, where the actual
 * question/answer live. Scoping extraction to this (rather than the whole
 * message) keeps quoted context or a "?" that appears *before* the command —
 * `On the "Returns" page, add an FAQ: …` — from being mistaken for FAQ content.
 * `hadCommand` is false when no command marker is found (then payload is the
 * whole message).
 */
function faqPayload(text: string): { payload: string; hadCommand: boolean } {
	const match = FAQ_COMMAND.exec(text);
	if (!match) {
		return { payload: text, hadCommand: false };
	}
	return { payload: text.slice(match.index + match[0].length).trim(), hadCommand: true };
}

/** Drop a leading `question:` / `q:` label so it never leaks into the question text. */
function stripQuestionLabel(value: string): string {
	return value.replace(/^(?:question|q)\s*[:=-]\s*/i, '').trim();
}

/** True when a candidate answer is really just "…to the/our knowledge base" command boilerplate. */
function isDestinationBoilerplate(value: string): boolean {
	return /^(?:to|into|in)\s+(?:the|our|my)\s+(?:knowledge[ -]?base|kb|faqs?)$/i.test(value);
}

/** Tidy an extracted answer: drop wrapping punctuation/quotes, an "answer:" label, trailing stops. */
function cleanAnswer(value: string): string {
	const cleaned = value
		.replace(/^[\s,.:;()\-–—"“„]+/, '')
		.replace(/^answer\s*[:=-]\s*/i, '')
		.replace(/["”“]+$/, '')
		.replace(/[.!?]+\s*$/, '')
		.replace(/\s+/g, ' ')
		.trim();
	// "add a faq \"Returns\" to the knowledge base" leaves "to the knowledge base"
	// after the title — that's where to put it, not the answer, so don't keep it.
	return isDestinationBoilerplate(cleaned) ? '' : cleaned;
}

/** Parse an FAQ-create ask into a question/answer pair, extracting as much as the user gave. */
function parseFaqCreate(text: string): { question: string | null; answer: string | null } {
	// 1. Explicit "question: ... answer: ..." (or "q: ..."). Only the full word
	// "answer" marks the split — a bare single-letter "a" would match a stray
	// "a-" / "a:" inside the question text (e.g. "a-la-carte") and truncate it.
	const qa = /\b(?:question|q)\s*[:-]\s*(.+?)\s+answer\s*[:-]\s*(.+)$/i.exec(text);
	if (qa?.[1] && qa[2]) {
		return { question: qa[1].trim(), answer: qa[2].trim() };
	}
	// Everything below works on the FAQ payload — the content *after* the
	// `add … faq` command — so quoted context or a "?" before the command is ignored.
	const { payload, hadCommand } = faqPayload(text);
	// 2. A double-quoted phrase is the question/title; whatever follows the closing
	// quote is the answer. Covers the natural phrasing people actually type, e.g.
	// `add this FAQ. "Our Cancelation Policy". It needs to be 24 hours in advance`.
	const quoted = QUOTED_TITLE.exec(payload);
	const title = quoted?.[1]?.trim();
	if (quoted && title) {
		const answer = cleanAnswer(payload.slice(quoted.index + quoted[0].length));
		return { question: title, answer: answer.length > 0 ? answer : null };
	}
	// 3. A natural "<question>? <answer>" split — e.g. `add an FAQ: do you deliver?
	// yes, city-wide`. Only trust the "?" when the message is framed as an add-FAQ
	// command, so a "?" in the *request* itself ("Can you add this to our FAQ? …")
	// isn't mistaken for the FAQ's question.
	const mark = payload.indexOf('?');
	if (hadCommand && payload.length > 0 && mark >= 0) {
		const question = stripQuestionLabel(payload.slice(0, mark + 1));
		if (/[\p{L}\p{N}]/u.test(question)) {
			const answer = cleanAnswer(payload.slice(mark + 1));
			return { question, answer: answer.length > 0 ? answer : null };
		}
	}
	// 4. Otherwise treat any "about <topic>" as the question and ask for the answer.
	const topic = afterPreposition(text);
	return { question: topic, answer: null };
}

/**
 * True when a message carries a knowledge-base *action* that's safe to infer from
 * an active FAQ conversation — browsing, searching, updating, or an "about …"
 * subject — as opposed to a bare "thanks". Deliberately excludes *creation*: a turn
 * that merely contains "add"/"create"/"make" is far more often a question to answer
 * ("how do I create an invoice?") than a request to add an FAQ, so creating one
 * requires explicit FAQ phrasing rather than being inferred from context.
 */
function hasFaqAction(lower: string): boolean {
	return (
		UPDATE_VERB.test(lower) ||
		SEARCH_VERB.test(lower) ||
		LIST_VERB.test(lower) ||
		afterPreposition(lower) !== null
	);
}

/**
 * Classify a single user message. Precedence matters: knowledge-base asks are
 * matched before company facts (so "search the FAQ about our hours" routes to
 * search, not the company record), and the most specific verbs win within each.
 *
 * `context` lets the caller say what the conversation is already about. When it's
 * `'faq'`, a message that carries an FAQ action but doesn't name the knowledge base
 * ("what should I add?") is still routed there — see {@link resolveIntent}.
 */
export function parseIntent(raw: string, context: IntentContext = {}): Intent {
	const text = raw.trim();
	const lower = text.toLowerCase();

	if (lower.length === 0) {
		return { kind: 'greeting' };
	}
	if (HELP.test(lower)) {
		return { kind: 'help' };
	}
	// A bare greeting with nothing else asked. Strip trailing punctuation first so
	// "hi!" / "hello." still count as a plain hello rather than falling through.
	const cleanLower = lower.replace(/[?.!]+$/, '').trim();
	if (GREETING.test(cleanLower) && cleanLower.replace(GREETING, '').trim().length === 0) {
		return { kind: 'greeting' };
	}

	// Company signals are read up front so they can both gate the inferred FAQ
	// context below and answer the company branch later (computed once).
	const companyFields = COMPANY_FIELD_PATTERNS.filter(([, pattern]) => pattern.test(lower)).map(
		([field]) => field,
	);
	const companyGeneric = COMPANY_GENERIC.test(lower);

	// Enter the knowledge-base branch when the message names it outright, or when the
	// conversation is already on it and this turn carries an FAQ action. A message
	// that names a company subject of its own (a field, or a generic "my company")
	// always wins over an inferred FAQ context, so "tell me about our website" stays
	// company info even mid-FAQ-conversation.
	const faqByContext =
		context.topic === 'faq' && hasFaqAction(lower) && companyFields.length === 0 && !companyGeneric;
	if (FAQ_CONTEXT.test(lower) || faqByContext) {
		if (UPDATE_VERB.test(lower)) {
			return { kind: 'faq_update', ...parseFaqUpdate(text) };
		}
		if (CREATE_VERB.test(lower)) {
			return { kind: 'faq_create', ...parseFaqCreate(text) };
		}
		// Search wins over list when there's an actual subject to search for.
		if (SEARCH_VERB.test(lower) || afterPreposition(lower)) {
			const query = extractSearchQuery(text);
			return query.length > 0 ? { kind: 'faq_search', query } : { kind: 'faq_list' };
		}
		if (LIST_VERB.test(lower)) {
			return { kind: 'faq_list' };
		}
		// A bare "faqs" / "knowledge base" — show the list.
		return { kind: 'faq_list' };
	}

	if (companyFields.length > 0) {
		return { kind: 'company_info', fields: companyFields };
	}
	if (companyGeneric) {
		// Generic ask → return the whole record.
		return { kind: 'company_info', fields: [] };
	}

	return { kind: 'unknown' };
}

/** The conversation topic an intent puts us on, or `null` if it sets none. */
function topicOf(intent: Intent): ConversationTopic | null {
	switch (intent.kind) {
		case 'faq_list':
		case 'faq_search':
		case 'faq_update':
		case 'faq_create':
		case 'faq_answer':
			return 'faq';
		case 'company_info':
			return 'company';
		default:
			return null;
	}
}

/**
 * Markers in the agent's *own* FAQ replies — a list, a search result, a knowledge
 * answer's citation, or a create/update confirmation. A prior user turn answered
 * from the knowledge base parses as `unknown` (it was a general question), so the
 * proof the conversation is on the FAQs lives in the assistant's reply, not the
 * user's ask. These phrases appear only in the agent's knowledge-base replies, not
 * its greeting or help text, so they don't misfire on boilerplate.
 */
const ASSISTANT_FAQ_REPLY =
	/your knowledge base (?:has|is empty)|from your faq|here’s what i found about|couldn’t find anything|added a new faq|i updated|currently says/i;

/** The topic an assistant turn establishes, read from the agent's FAQ-reply markers. */
function assistantTopic(content: string): ConversationTopic | null {
	return ASSISTANT_FAQ_REPLY.test(content) ? 'faq' : null;
}

/**
 * How many recent turns (either side) a subjectless follow-up looks back over for
 * its topic. A short window keeps the inference relevant (a topic from far earlier
 * shouldn't bind "now") and bounds the work done on every turn — re-parsing an
 * unbounded history would risk the Workers CPU limit on a long conversation.
 */
const CONTEXT_LOOKBACK_TURNS = 6;

/**
 * The subject the conversation is already on, read from the most recent *earlier*
 * turn that established one. We look at both sides: a user turn via its parsed
 * intent, and an assistant turn via the agent's FAQ-reply markers — so context the
 * user set ("how many faqs?") *and* context only the assistant's answer proves
 * (a knowledge answer to "what's our best price?") both count. The latest turn is
 * skipped — it's the one we couldn't read on its own — and the scan is capped at
 * the last {@link CONTEXT_LOOKBACK_TURNS} turns to keep it relevant and bounded.
 */
function recentTopic(messages: ChatMessage[]): ConversationTopic | null {
	// Drop the latest user turn: it's what we're resolving, not context for itself.
	let lastUserIndex = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i]?.role === 'user') {
			lastUserIndex = i;
			break;
		}
	}
	let scanned = 0;
	for (let i = lastUserIndex - 1; i >= 0 && scanned < CONTEXT_LOOKBACK_TURNS; i--) {
		const turn = messages[i];
		if (!turn || turn.role === 'system') {
			continue;
		}
		const topic =
			turn.role === 'assistant' ? assistantTopic(turn.content) : topicOf(parseIntent(turn.content));
		scanned += 1;
		if (topic) {
			return topic;
		}
	}
	return null;
}

/**
 * Understand the latest user turn *in the context of the conversation*. Most
 * turns name their own subject and are read on their own. But a natural follow-up
 * — "what should I add?" right after looking at the FAQs — names nothing, so on its
 * own it's `unknown` and the user gets a generic brush-off. Here we notice the
 * conversation was already about the knowledge base and re-read the turn with that
 * context, so the follow-up lands where the user meant it.
 *
 * This is the single seam the agent uses, so making understanding conversational
 * (or model-backed) later means changing only this layer.
 */
export function resolveIntent(messages: ChatMessage[]): Intent {
	const latest = lastUserMessage(messages) ?? '';
	const direct = parseIntent(latest);
	// A turn that already stands on its own needs no help from earlier ones.
	if (direct.kind !== 'unknown') {
		return direct;
	}
	const topic = recentTopic(messages);
	return topic ? parseIntent(latest, { topic }) : direct;
}

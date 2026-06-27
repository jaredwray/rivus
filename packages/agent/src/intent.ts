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
 */

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
	| { kind: 'unknown' };

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

/** Parse an FAQ-create ask into an explicit question/answer pair when supplied. */
function parseFaqCreate(text: string): { question: string | null; answer: string | null } {
	// "question: ... answer: ..." (or "q: ..."). Only the full word "answer" marks
	// the split — a bare single-letter "a" would match a stray "a-" / "a:" inside
	// the question text (e.g. "a-la-carte") and truncate it.
	const qa = /\b(?:question|q)\s*[:-]\s*(.+?)\s+answer\s*[:-]\s*(.+)$/i.exec(text);
	if (qa?.[1] && qa[2]) {
		return { question: qa[1].trim(), answer: qa[2].trim() };
	}
	// Otherwise treat any "about <topic>" as the question and ask for the answer.
	const topic = afterPreposition(text);
	return { question: topic, answer: null };
}

/**
 * Classify a single user message. Precedence matters: knowledge-base asks are
 * matched before company facts (so "search the FAQ about our hours" routes to
 * search, not the company record), and the most specific verbs win within each.
 */
export function parseIntent(raw: string): Intent {
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

	if (FAQ_CONTEXT.test(lower)) {
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

	const fields = COMPANY_FIELD_PATTERNS.filter(([, pattern]) => pattern.test(lower)).map(
		([field]) => field,
	);
	if (fields.length > 0) {
		return { kind: 'company_info', fields };
	}
	if (COMPANY_GENERIC.test(lower)) {
		// Generic ask → return the whole record.
		return { kind: 'company_info', fields: [] };
	}

	return { kind: 'unknown' };
}

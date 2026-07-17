import {
	type AuthTokenPayload,
	type ChatMessage,
	createFaqSchema,
	type Faq,
	updateFaqSchema,
} from '@rivus/core';
import { parseHttpUrl } from '../web-browse';
import type { ChatActions } from './actions';
import { GREETING, lastUserMessage } from './conversation';
import type { Decide } from './decide';
import { type CompanyField, type Intent, resolveIntent } from './intent';

/**
 * The brain of the Rivus chat. Given a conversation and the resolved session, it
 * understands the latest ask (`decide.ts` / `intent.ts`) and fulfils it against
 * the account's data (`actions.ts`), formatting a single `{ reply }` string.
 *
 * Ported from the standalone agent's `assistant.ts` with one structural change:
 * actions execute in-process against the API's repositories and AI services
 * instead of over HTTP with a forwarded token. The conversational contract is
 * unchanged — anonymous callers are first-class (greeting, help, and friendly
 * sign-in nudges, never an error), and a session that no longer revalidates gets
 * a sign-in-again reply rather than a 401.
 */

/**
 * The caller's authentication state, resolved by the route before replying:
 *
 * - `anonymous` — no token (or an invalid one). Greeting/help work; anything
 *   needing data becomes a sign-in nudge. These turns are routed with the
 *   deterministic parser only, so a signed-out transcript is never sent to a
 *   model (and never costs a model call).
 * - `stale` — a validly signed token whose session no longer holds up (revoked
 *   membership, canceled or deleted account). Conversational intents still work
 *   and stay personalized; anything touching data explains the session expired.
 *   Mirrors the standalone agent, where these calls hit the API and its 401 was
 *   turned into the same sentence.
 * - `active` — a revalidated session, with the account-bound {@link ChatActions}
 *   to execute against.
 */
export type ChatSession =
	| { kind: 'anonymous' }
	| { kind: 'stale'; claims: AuthTokenPayload }
	| { kind: 'active'; claims: AuthTokenPayload; actions: ChatActions };

export interface RespondDeps {
	messages: ChatMessage[];
	session: ChatSession;
	/** Decides the action for a signed-in turn (model-backed or deterministic). */
	decide: Decide;
	/** Surfaced so a failed action is visible in logs; replies stay friendly. */
	logger?: { warn(message: string): void };
}

const SIGN_IN_REQUIRED =
	"You'll need to be signed in for that. Once you sign in to Rivus, I can pull up your company details and search or update your knowledge base.";

const SESSION_EXPIRED =
	'Your session looks like it expired. Please sign in again and I’ll pick right back up.';

const SOMETHING_FAILED =
	'Sorry — I couldn’t reach your Rivus data just now. Please try again in a moment.';

const EMPTY_KB =
	"Your knowledge base is empty. Add your first FAQ and I'll be able to search and update it for you.";

/** Human label for each company field, used in the full-record summary. */
const FIELD_LABEL: Record<CompanyField, string> = {
	name: 'Business name',
	website: 'Website',
	phone: 'Phone',
	address: 'Address',
	timezone: 'Time zone',
	slug: 'Rivus handle',
	status: 'Account status',
};

/** Produce Rivus's reply to the most recent user turn. */
export async function respond(deps: RespondDeps): Promise<string> {
	const { messages, session, decide, logger } = deps;
	const question = lastUserMessage(messages) ?? '';
	const claims = session.kind === 'anonymous' ? null : session.claims;

	// Decide which tool the latest turn calls for — spending a model call only when
	// it can matter. An empty open (the app posts an empty transcript just to get
	// the greeting) is the greeting, full stop. An unauthenticated caller can only
	// be greeted, helped, or nudged to sign in, so it's routed deterministically —
	// its transcript is never sent to a third-party model, nor does it incur model
	// cost. Signed-in turns route via the injected decider (model-backed when a key
	// is configured, the same deterministic router otherwise).
	let intent: Intent;
	if (question.trim() === '') {
		intent = { kind: 'greeting' };
	} else if (session.kind !== 'anonymous') {
		intent = await decide(messages);
	} else {
		intent = resolveIntent(messages);
	}

	// Conversational intents need no data and work signed in or out.
	if (intent.kind === 'greeting') {
		return greetingReply(claims);
	}
	if (intent.kind === 'help') {
		return helpReply(claims);
	}

	// Everything below needs a live session. A general question (`unknown`, or a
	// model-chosen `faq_answer`) is the catch-all: rather than brushing it off, we
	// try to answer it from the knowledge base with AI. It still degrades to a
	// friendly nudge — not an error — when we can't reach the data.
	const isQuestion = intent.kind === 'unknown' || intent.kind === 'faq_answer';
	if (session.kind === 'anonymous') {
		return isQuestion ? unknownReply(null) : SIGN_IN_REQUIRED;
	}
	if (session.kind === 'stale') {
		// The standalone agent reached this state one hop later — the API answered
		// 401 to its forwarded token — and replied with exactly this sentence.
		return SESSION_EXPIRED;
	}
	const { actions } = session;

	try {
		switch (intent.kind) {
			case 'company_info':
				return await companyInfoReply(actions, intent.fields);
			case 'faq_list':
				return await faqListReply(actions);
			case 'faq_search':
				return await faqSearchReply(actions, intent, question);
			case 'faq_update':
				return await faqUpdateReply(actions, intent);
			case 'faq_create':
				return await faqCreateReply(actions, intent);
			case 'faq_answer':
				return await knowledgeAnswerReply(actions, intent.question, claims);
			case 'web_search':
				return await webSearchReply(actions, intent, logger);
			case 'web_browse':
				return await webBrowseReply(actions, intent, logger);
			case 'unknown':
				return await knowledgeAnswerReply(actions, question, claims);
		}
	} catch (error) {
		logger?.warn(`chat action ${intent.kind} failed — ${String(error)}`);
		return SOMETHING_FAILED;
	}
}

/* -------------------------------------------------------------------------- */
/* Conversational replies                                                     */
/* -------------------------------------------------------------------------- */

function greetingReply(claims: AuthTokenPayload | null): string {
	if (!claims) {
		return `${GREETING} Sign in to Rivus and I can pull up your company details and your knowledge base.`;
	}
	return `${GREETING} You're signed in as ${claims.email}. Ask me about your company details — like your website — or to search and update your knowledge base.`;
}

function helpReply(claims: AuthTokenPayload | null): string {
	const lines = [
		'Here’s what I can do:',
		'• Tell you your company details — e.g. “what’s our website?”',
		'• Search your knowledge base — e.g. “find FAQs about refunds”',
		'• Update or add an FAQ — e.g. “update the FAQ about returns to say …”',
		'• Search the web — e.g. “search the web for permit requirements in Portland”',
		'• Read a web page — e.g. “read https://example.com/pricing”',
	];
	if (!claims) {
		lines.push('', 'Sign in first and I’ll do all of this against your account.');
	}
	return lines.join('\n');
}

function unknownReply(claims: AuthTokenPayload | null): string {
	if (!claims) {
		return `${GREETING} I can help with your company details and your knowledge base once you’re signed in. Try “what’s our website?” or “search the FAQ for pricing.”`;
	}
	return 'I’m not sure how to help with that yet. I can tell you your company details (like your website) or search and update your knowledge base — try “what’s our phone number?” or “find FAQs about pricing.”';
}

/**
 * Answer a general question from the account's knowledge base. The answering
 * service does the AI work — it retrieves the relevant FAQs and composes an
 * answer grounded strictly in them — so the chat just forwards the question and
 * formats the result, citing the source FAQ so the user can see it came from
 * their own knowledge base. When the knowledge base doesn't cover the question,
 * we fall back to the same friendly nudge as any other unrecognized ask rather
 * than guessing.
 */
async function knowledgeAnswerReply(
	actions: ChatActions,
	question: string,
	claims: AuthTokenPayload | null,
): Promise<string> {
	const { answered, answer, sources } = await actions.answerFromKnowledge({ question });
	const text = answer.trim();
	if (!answered || text === '') {
		return unknownReply(claims);
	}
	return formatGroundedAnswer(text, sources);
}

/** Present a grounded answer, citing the source FAQ so the user sees where it came from. */
function formatGroundedAnswer(
	answer: string,
	sources: ReadonlyArray<{ question: string }>,
): string {
	const [source] = sources;
	return source ? `${answer}\n\n(From your FAQ “${source.question}”.)` : answer;
}

/* -------------------------------------------------------------------------- */
/* Company context                                                            */
/* -------------------------------------------------------------------------- */

async function companyInfoReply(actions: ChatActions, fields: CompanyField[]): Promise<string> {
	const { account } = await actions.me();
	if (fields.length === 0) {
		// Generic ask → the whole record, with blanks shown so it reads as complete.
		const rows = (Object.keys(FIELD_LABEL) as CompanyField[]).map((field) => {
			const value = companyFieldValue(account, field);
			return `• ${FIELD_LABEL[field]}: ${value === '' ? 'not set' : value}`;
		});
		return [`Here’s what I have for ${account.name}:`, ...rows].join('\n');
	}
	return fields.map((field) => companyFieldSentence(account, field)).join('\n');
}

interface CompanyRecord {
	name: string;
	website: string;
	phone: string;
	address: string;
	timezone: string;
	slug: string;
	status: string;
}

function companyFieldValue(account: CompanyRecord, field: CompanyField): string {
	switch (field) {
		case 'name':
			return account.name;
		case 'website':
			return account.website;
		case 'phone':
			return account.phone;
		case 'address':
			return account.address;
		case 'timezone':
			return account.timezone;
		case 'slug':
			return account.slug;
		case 'status':
			return account.status;
	}
}

function companyFieldSentence(account: CompanyRecord, field: CompanyField): string {
	const value = companyFieldValue(account, field);
	if (value === '') {
		const label = FIELD_LABEL[field].toLowerCase();
		return `You haven’t added a ${label} yet — you can set one in Settings.`;
	}
	switch (field) {
		case 'name':
			return `Your business name is ${value}.`;
		case 'website':
			return `Your website is ${value}.`;
		case 'phone':
			return `Your phone number is ${value}.`;
		case 'address':
			return `Your address is ${value}.`;
		case 'timezone':
			return `Your time zone is ${value}.`;
		case 'slug':
			return `Your Rivus handle is ${value}.`;
		case 'status':
			return `Your account is ${value}.`;
	}
}

/* -------------------------------------------------------------------------- */
/* Knowledge base                                                             */
/* -------------------------------------------------------------------------- */

// One page wide enough to cover a small business's whole knowledge base, so a
// search or topic match considers everything rather than just the newest few.
const FAQ_SCAN_PAGE_SIZE = 100;
// Bound the scan so a pathological knowledge base can't fan out unbounded
// repository reads inside one request. 10 pages × 100 = 1000 FAQs — far beyond a
// real small business — after which we tell the user the scan was partial.
const FAQ_SCAN_MAX_PAGES = 10;

/**
 * Read the account's FAQs across pages (a page caps at 100 and lists
 * newest-first), so a search or topic match considers the whole knowledge base —
 * not just the most recent 100. `complete` is false when the cap cut the scan short.
 */
async function scanFaqs(actions: ChatActions): Promise<{ faqs: Faq[]; complete: boolean }> {
	const faqs: Faq[] = [];
	let page = 1;
	let hasNextPage = true;
	while (hasNextPage && page <= FAQ_SCAN_MAX_PAGES) {
		const result = await actions.listFaqs({ page, pageSize: FAQ_SCAN_PAGE_SIZE });
		faqs.push(...result.data);
		hasNextPage = result.meta.hasNextPage;
		page += 1;
	}
	return { faqs, complete: !hasNextPage };
}

async function faqListReply(actions: ChatActions): Promise<string> {
	const { data, meta } = await actions.listFaqs({ page: 1, pageSize: 20 });
	if (meta.total === 0) {
		return EMPTY_KB;
	}
	const shown = data.slice(0, 10).map((faq) => `• ${faq.question}`);
	const remainder = meta.total - shown.length;
	const header = `Your knowledge base has ${meta.total} FAQ${meta.total === 1 ? '' : 's'}:`;
	const lines = [header, ...shown];
	if (remainder > 0) {
		lines.push(`…and ${remainder} more. Ask me to search for a topic to narrow it down.`);
	}
	return lines.join('\n');
}

/**
 * Reply to a knowledge-base search. A *question* about the knowledge base ("what
 * does the FAQ say about our best price?") is best served by a grounded AI answer —
 * keyword search alone can't connect "best price" to a differently-worded "cost"
 * FAQ. So unless the ask is an existence check, we try the AI answer first and fall
 * back to the keyword list when the knowledge base has no grounded answer (or the
 * answer call fails). Existence checks ("do we have an FAQ about X?") skip straight
 * to the list, where the matching FAQ titles are the better reply.
 */
async function faqSearchReply(
	actions: ChatActions,
	intent: Extract<Intent, { kind: 'faq_search' }>,
	rawQuestion: string,
): Promise<string> {
	if (!intent.existence) {
		const grounded = await groundedSearchAnswer(actions, rawQuestion);
		if (grounded) {
			return grounded;
		}
	}
	const { faqs, complete } = await scanFaqs(actions);
	if (faqs.length === 0) {
		return EMPTY_KB;
	}
	const ranked = rankFaqs(faqs, intent.query);
	if (ranked.length === 0) {
		const scope = complete ? 'your knowledge base' : `the ${faqs.length} most recent FAQs`;
		return `I couldn’t find anything in ${scope} about “${intent.query}”. Try different wording, or ask me to list all your FAQs.`;
	}
	const lines = ranked.slice(0, 3).map((faq) => `• ${faq.question}\n  ${snippet(faq.answer)}`);
	return [`Here’s what I found about “${intent.query}”:`, ...lines].join('\n');
}

/**
 * Try to answer `question` from the knowledge base, returning the formatted, cited
 * answer — or null when the knowledge base doesn't cover it, the answer is blank, or
 * the lookup fails. A failure returns null (not an error) so the caller falls back
 * to the keyword list rather than breaking the search.
 */
async function groundedSearchAnswer(
	actions: ChatActions,
	question: string,
): Promise<string | null> {
	try {
		const { answered, answer, sources } = await actions.answerFromKnowledge({ question });
		const text = answer.trim();
		return answered && text !== '' ? formatGroundedAnswer(text, sources) : null;
	} catch {
		return null;
	}
}

async function faqUpdateReply(
	actions: ChatActions,
	intent: Extract<Intent, { kind: 'faq_update' }>,
): Promise<string> {
	if (intent.topic === '') {
		return 'Which FAQ should I update? Tell me the topic — e.g. “update the FAQ about refunds to say we offer 30-day refunds.”';
	}
	const { faqs } = await scanFaqs(actions);
	if (faqs.length === 0) {
		return EMPTY_KB;
	}
	const matches = matchFaqsByTopic(faqs, intent.topic);
	if (matches.length > 1) {
		const options = matches.slice(0, 5).map((faq) => `• ${faq.question}`);
		return [`I found a few FAQs that could match “${intent.topic}”. Which one?`, ...options].join(
			'\n',
		);
	}
	const [target] = matches;
	if (!target) {
		return `I couldn’t find an FAQ about “${intent.topic}”. Ask me to list your FAQs and I’ll show you what’s there.`;
	}
	if (intent.answer === null) {
		// Rivus replies one message at a time with no memory of this turn, so ask for
		// the whole instruction in a single message rather than a follow-up it can't
		// tie back to this FAQ.
		return `The FAQ “${target.question}” currently says:\n  ${snippet(target.answer)}\nTo change it, send the whole instruction in one message, e.g. “update the FAQ about ${intent.topic} to say <your new answer>”.`;
	}
	const parsed = updateFaqSchema.safeParse({ answer: intent.answer });
	if (!parsed.success) {
		return parsed.error.issues[0]?.message ?? 'That update doesn’t look valid — please try again.';
	}
	const updated = await actions.updateFaq(target.id, { answer: intent.answer });
	return `Done — I updated “${updated.question}”. It now reads:\n  ${snippet(updated.answer)}`;
}

async function faqCreateReply(
	actions: ChatActions,
	intent: Extract<Intent, { kind: 'faq_create' }>,
): Promise<string> {
	if (intent.question === null && intent.answer === null) {
		return 'Sure — what question should the FAQ answer, and what’s the answer? For example: “add an FAQ question: Do you offer refunds? answer: Yes, within 30 days.”';
	}
	// The parser only fills `answer` alongside a `question`, so a lone question here
	// means we still need the answer. Rivus has no memory of this turn, so ask for
	// the full command in one message rather than a follow-up.
	if (intent.answer === null) {
		return `Got it — the question is “${intent.question}”. Send it in one message with the answer, e.g. “add an FAQ question: ${intent.question} answer: <your answer>”.`;
	}
	const parsed = createFaqSchema.safeParse({ question: intent.question, answer: intent.answer });
	if (!parsed.success) {
		return parsed.error.issues[0]?.message ?? 'That FAQ doesn’t look valid — please try again.';
	}
	// Mirror the app's pre-create flow: surface a near-duplicate (AI-assisted) and
	// steer the user toward updating it instead of polluting the knowledge base.
	// The check is a no-op when the API has no AI provider configured.
	const similar = await actions.findSimilarFaq({
		question: parsed.data.question,
		answer: parsed.data.answer,
	});
	if (similar.match) {
		return `That looks a lot like an existing FAQ — “${similar.match.question}”. I didn’t add a duplicate. To update that one instead, say “update the FAQ about ${similar.match.question} to say ${parsed.data.answer}”, or reword your question if it’s genuinely different.`;
	}
	const created = await actions.createFaq(parsed.data);
	return `Added a new FAQ: “${created.question}”.`;
}

/* -------------------------------------------------------------------------- */
/* Web tools (search + browse)                                                */
/* -------------------------------------------------------------------------- */

const WEB_SEARCH_DISABLED =
	'Web search isn’t enabled on this server yet — an administrator can turn it on with a Brave Search API key. Meanwhile I can still help with your company details and knowledge base.';

const WEB_BROWSE_DISABLED =
	'Web browsing isn’t enabled on this server yet — an administrator can turn it on with a ZenRows API key. Meanwhile I can still help with your company details and knowledge base.';

/** How much of a browsed page a chat reply quotes before trailing off. */
const PAGE_REPLY_CHARS = 1500;

async function webSearchReply(
	actions: ChatActions,
	intent: Extract<Intent, { kind: 'web_search' }>,
	logger?: { warn(message: string): void },
): Promise<string> {
	let outcome: {
		enabled: boolean;
		results: Awaited<ReturnType<ChatActions['searchWeb']>>['results'];
	};
	try {
		outcome = await actions.searchWeb({ query: intent.query });
	} catch (error) {
		// A provider outage is not a Rivus-data failure, so it gets its own honest
		// sentence instead of the generic one — but is still logged for operators.
		logger?.warn(`chat web search failed — ${String(error)}`);
		return 'I couldn’t reach web search just now — please try again in a moment.';
	}
	if (!outcome.enabled) {
		return WEB_SEARCH_DISABLED;
	}
	if (outcome.results.length === 0) {
		return `I searched the web for “${intent.query}” and came back empty. Try rewording it?`;
	}
	const lines = outcome.results.map((result) => {
		const description = snippet(result.description);
		return description === ''
			? `• ${result.title}\n  ${result.url}`
			: `• ${result.title} — ${description}\n  ${result.url}`;
	});
	return [`Here’s what I found on the web for “${intent.query}”:`, ...lines].join('\n');
}

async function webBrowseReply(
	actions: ChatActions,
	intent: Extract<Intent, { kind: 'web_browse' }>,
	logger?: { warn(message: string): void },
): Promise<string> {
	// Both routers only emit http(s) URLs, but a custom decider could hand us
	// anything — refuse non-web addresses with guidance, not an error path.
	if (parseHttpUrl(intent.url) === null) {
		return 'I can only open full web addresses starting with http:// or https:// — e.g. “read https://example.com/pricing”.';
	}
	let outcome: { enabled: boolean; content: string };
	try {
		outcome = await actions.browsePage({ url: intent.url });
	} catch (error) {
		logger?.warn(`chat web browse failed — ${String(error)}`);
		return `I couldn’t read ${intent.url} just now — the site may be down or blocking access. Please try again in a moment.`;
	}
	if (!outcome.enabled) {
		return WEB_BROWSE_DISABLED;
	}
	const content = pageSnippet(outcome.content);
	if (content === '') {
		return `I opened ${intent.url} but couldn’t find any readable content there.`;
	}
	return `Here’s what I found at ${intent.url}:\n\n${content}`;
}

/**
 * Cap a browsed page for a chat reply. Unlike {@link snippet} it keeps line
 * structure — the content is markdown, and flattening it would glue headings
 * and list items into one unreadable run.
 */
function pageSnippet(content: string, max = PAGE_REPLY_CHARS): string {
	const clean = content
		.replace(/\r\n?/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/* -------------------------------------------------------------------------- */
/* Text helpers                                                               */
/* -------------------------------------------------------------------------- */

// Words too common to help a knowledge-base match; dropped before scoring.
const STOPWORDS = new Set([
	'the',
	'and',
	'for',
	'our',
	'you',
	'your',
	'what',
	'whats',
	'about',
	'faq',
	'faqs',
	'have',
	'does',
	'with',
	'this',
	'that',
	'are',
	'can',
]);

/** Lowercased word tokens worth matching on (short/stopword tokens dropped). */
function tokenize(value: string): string[] {
	// Unicode letter/number classes (not ASCII-only ranges) so accented and
	// non-Latin knowledge bases (e.g. "café", non-Latin scripts) tokenize correctly.
	return (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
		(token) => token.length > 2 && !STOPWORDS.has(token),
	);
}

/** How many query tokens appear anywhere in an FAQ's question/answer/category. */
function scoreFaq(tokens: string[], faq: Faq): number {
	const haystack = `${faq.question} ${faq.answer} ${faq.category}`.toLowerCase();
	let score = 0;
	for (const token of tokens) {
		if (haystack.includes(token)) {
			score += 1;
		}
	}
	return score;
}

/** FAQs ranked by relevance to `query`, best first, zero-score entries dropped. */
function rankFaqs(faqs: Faq[], query: string): Faq[] {
	const tokens = tokenize(query);
	const needle = query.trim().toLowerCase();
	return faqs
		.map((faq) => {
			// Fall back to a raw substring match when the query is all stopwords/short.
			const score =
				tokens.length > 0
					? scoreFaq(tokens, faq)
					: needle.length > 0 && `${faq.question} ${faq.answer}`.toLowerCase().includes(needle)
						? 1
						: 0;
			return { faq, score };
		})
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score)
		.map((entry) => entry.faq);
}

/** FAQs that plausibly concern `topic` — question substring first, then ranking. */
function matchFaqsByTopic(faqs: Faq[], topic: string): Faq[] {
	const needle = topic.trim().toLowerCase();
	const byQuestion = faqs.filter((faq) => faq.question.toLowerCase().includes(needle));
	if (byQuestion.length > 0) {
		return byQuestion;
	}
	return rankFaqs(faqs, topic);
}

/** Collapse whitespace and cap a long answer so a reply stays scannable. */
function snippet(text: string, max = 180): string {
	const clean = text.replace(/\s+/g, ' ').trim();
	return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

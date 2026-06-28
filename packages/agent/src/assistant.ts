import { createFaqSchema, type Faq, updateFaqSchema } from '@rivus/core';
import { AgentApiError, createRivusApiClient, type FetchLike, type RivusApiClient } from './api';
import { authenticate } from './auth';
import { GREETING, lastUserMessage } from './conversation';
import { createDeciderFromEnv, type Decide } from './decide';
import { type CompanyField, type Intent, resolveIntent } from './intent';
import type { ChatMessage, Env, SessionClaims } from './types';

/**
 * The authenticated brain of the agent. Given a conversation and the incoming
 * request, it:
 *
 *   1. verifies the session (JWT from a bearer header or the `rivus_session`
 *      cookie — see `auth.ts`),
 *   2. understands the latest ask (`intent.ts`), and
 *   3. for signed-in users, fulfils it by calling the Rivus API on their behalf
 *      (`api.ts`) and formatting the result.
 *
 * Everything protected (company facts, knowledge-base reads/writes) requires a
 * valid session; anonymous callers get a friendly nudge to sign in. The API
 * stays the authority on permissions, so the agent simply forwards the user's
 * token and turns any 401/403 into a clear sentence.
 *
 * It performs I/O only through the injected `fetch`, so — like the app's API
 * client — it is unit-tested hermetically with a mocked `fetch` and a locally
 * signed token.
 */

export interface RespondDeps {
	env: Env;
	request: Request;
	messages: ChatMessage[];
	/** Injected for tests; defaults to the global `fetch` in the Worker. */
	fetchImpl?: FetchLike;
	/**
	 * Decides the agent's action from the conversation. Injected for tests; defaults
	 * to a model-backed router (or the rule-based parser when no model is configured).
	 */
	decide?: Decide;
}

const SIGN_IN_REQUIRED =
	"You'll need to be signed in for that. Once you sign in to Rivus, I can pull up your company details and search or update your knowledge base.";

const NOT_CONFIGURED =
	"I can't reach your Rivus account right now — the agent isn't fully configured. Please try again later.";

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

/** Produce the agent's reply to the most recent user turn. */
export async function respond(deps: RespondDeps): Promise<string> {
	const { env, request, messages, fetchImpl } = deps;
	const question = lastUserMessage(messages) ?? '';
	const session = await authenticate(request, env.JWT_SECRET);
	const claims = session?.claims ?? null;

	// Decide which tool the latest turn calls for — authenticating first, and spending
	// a model call only when it can matter. An empty open (the app posts an empty
	// transcript just to get the greeting) is the greeting, full stop. An
	// unauthenticated caller can only be greeted, helped, or nudged to sign in, so it's
	// routed deterministically — its transcript is never sent to a third-party model,
	// nor does it incur model cost. Signed-in turns route via the model when one is
	// configured; otherwise the same deterministic router.
	let intent: Intent;
	if (question.trim() === '') {
		intent = { kind: 'greeting' };
	} else if (session) {
		const decide: Decide = deps.decide ?? createDeciderFromEnv(env);
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

	// Everything below needs a session and a configured API. A general question
	// (`unknown`, or a model-chosen `faq_answer`) is the catch-all: rather than
	// brushing it off, we try to answer it from the knowledge base with AI. It still
	// degrades to a friendly nudge — not the sign-in / not-configured errors — when
	// we can't reach the data.
	const isQuestion = intent.kind === 'unknown' || intent.kind === 'faq_answer';
	if (!session) {
		return isQuestion ? unknownReply(null) : SIGN_IN_REQUIRED;
	}
	if (!env.RIVUS_API_URL) {
		return isQuestion ? unknownReply(claims) : NOT_CONFIGURED;
	}
	const api = createRivusApiClient(env.RIVUS_API_URL, session.token, fetchImpl);

	try {
		switch (intent.kind) {
			case 'company_info':
				return await companyInfoReply(api, intent.fields);
			case 'faq_list':
				return await faqListReply(api);
			case 'faq_search':
				return await faqSearchReply(api, intent, question);
			case 'faq_update':
				return await faqUpdateReply(api, intent);
			case 'faq_create':
				return await faqCreateReply(api, intent);
			case 'faq_answer':
				return await knowledgeAnswerReply(api, intent.question, claims);
			case 'unknown':
				return await knowledgeAnswerReply(api, question, claims);
		}
	} catch (error) {
		return apiErrorReply(error);
	}
}

/* -------------------------------------------------------------------------- */
/* Conversational replies                                                     */
/* -------------------------------------------------------------------------- */

function greetingReply(claims: SessionClaims | null): string {
	if (!claims) {
		return `${GREETING} Sign in to Rivus and I can pull up your company details and your knowledge base.`;
	}
	return `${GREETING} You're signed in as ${claims.email}. Ask me about your company details — like your website — or to search and update your knowledge base.`;
}

function helpReply(claims: SessionClaims | null): string {
	const lines = [
		'Here’s what I can do:',
		'• Tell you your company details — e.g. “what’s our website?”',
		'• Search your knowledge base — e.g. “find FAQs about refunds”',
		'• Update or add an FAQ — e.g. “update the FAQ about returns to say …”',
	];
	if (!claims) {
		lines.push('', 'Sign in first and I’ll do all of this against your account.');
	}
	return lines.join('\n');
}

function unknownReply(claims: SessionClaims | null): string {
	if (!claims) {
		return `${GREETING} I can help with your company details and your knowledge base once you’re signed in. Try “what’s our website?” or “search the FAQ for pricing.”`;
	}
	return 'I’m not sure how to help with that yet. I can tell you your company details (like your website) or search and update your knowledge base — try “what’s our phone number?” or “find FAQs about pricing.”';
}

/**
 * Answer a general question from the account's knowledge base. The API does the AI
 * work — it retrieves the relevant FAQs and composes an answer grounded strictly in
 * them — so the agent just forwards the question and formats the result, citing the
 * source FAQ so the user can see it came from their own knowledge base. When the
 * knowledge base doesn't cover the question, we fall back to the same friendly nudge
 * as any other unrecognized ask rather than guessing.
 */
async function knowledgeAnswerReply(
	api: RivusApiClient,
	question: string,
	claims: SessionClaims | null,
): Promise<string> {
	const { answered, answer, sources } = await api.answerFromKnowledge({ question });
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

async function companyInfoReply(api: RivusApiClient, fields: CompanyField[]): Promise<string> {
	const { account } = await api.me();
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

function companyFieldValue(
	account: {
		name: string;
		website: string;
		phone: string;
		address: string;
		timezone: string;
		slug: string;
		status: string;
	},
	field: CompanyField,
): string {
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

function companyFieldSentence(
	account: Parameters<typeof companyFieldValue>[0],
	field: CompanyField,
): string {
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
// Bound the scan so a pathological knowledge base can't fan out unbounded API
// calls inside one Worker request. 10 pages × 100 = 1000 FAQs — far beyond a real
// small business — after which we tell the user the scan was partial.
const FAQ_SCAN_MAX_PAGES = 10;

/**
 * Read the account's FAQs across pages (the API caps a page at 100 and returns
 * newest-first), so a search or topic match considers the whole knowledge base —
 * not just the most recent 100. `complete` is false when the cap cut the scan short.
 */
async function scanFaqs(api: RivusApiClient): Promise<{ faqs: Faq[]; complete: boolean }> {
	const faqs: Faq[] = [];
	let page = 1;
	let hasNextPage = true;
	while (hasNextPage && page <= FAQ_SCAN_MAX_PAGES) {
		const result = await api.listFaqs({ page, pageSize: FAQ_SCAN_PAGE_SIZE });
		faqs.push(...result.data);
		hasNextPage = result.meta.hasNextPage;
		page += 1;
	}
	return { faqs, complete: !hasNextPage };
}

async function faqListReply(api: RivusApiClient): Promise<string> {
	const { data, meta } = await api.listFaqs({ page: 1, pageSize: 20 });
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
	api: RivusApiClient,
	intent: Extract<Intent, { kind: 'faq_search' }>,
	rawQuestion: string,
): Promise<string> {
	if (!intent.existence) {
		const grounded = await groundedSearchAnswer(api, rawQuestion);
		if (grounded) {
			return grounded;
		}
	}
	const { faqs, complete } = await scanFaqs(api);
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
 * the answer call fails. A failure returns null (not an error) so the caller falls
 * back to the keyword list rather than breaking the search.
 */
async function groundedSearchAnswer(api: RivusApiClient, question: string): Promise<string | null> {
	try {
		const { answered, answer, sources } = await api.answerFromKnowledge({ question });
		const text = answer.trim();
		return answered && text !== '' ? formatGroundedAnswer(text, sources) : null;
	} catch {
		return null;
	}
}

async function faqUpdateReply(
	api: RivusApiClient,
	intent: Extract<Intent, { kind: 'faq_update' }>,
): Promise<string> {
	if (intent.topic === '') {
		return 'Which FAQ should I update? Tell me the topic — e.g. “update the FAQ about refunds to say we offer 30-day refunds.”';
	}
	const { faqs } = await scanFaqs(api);
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
	const updated = await api.updateFaq(target.id, { answer: intent.answer });
	return `Done — I updated “${updated.question}”. It now reads:\n  ${snippet(updated.answer)}`;
}

async function faqCreateReply(
	api: RivusApiClient,
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
	const similar = await api.findSimilarFaq({
		question: parsed.data.question,
		answer: parsed.data.answer,
	});
	if (similar.match) {
		return `That looks a lot like an existing FAQ — “${similar.match.question}”. I didn’t add a duplicate. To update that one instead, say “update the FAQ about ${similar.match.question} to say ${parsed.data.answer}”, or reword your question if it’s genuinely different.`;
	}
	const created = await api.createFaq(parsed.data);
	return `Added a new FAQ: “${created.question}”.`;
}

/* -------------------------------------------------------------------------- */
/* Errors & text helpers                                                      */
/* -------------------------------------------------------------------------- */

function apiErrorReply(error: unknown): string {
	if (error instanceof AgentApiError) {
		if (error.status === 401) {
			return 'Your session looks like it expired. Please sign in again and I’ll pick right back up.';
		}
		if (error.status === 403) {
			return 'You don’t have permission to do that on this account.';
		}
	}
	return 'Sorry — I couldn’t reach your Rivus data just now. Please try again in a moment.';
}

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

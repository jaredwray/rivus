import { createFaqSchema, type Faq, updateFaqSchema } from '@rivus/core';
import { AgentApiError, createRivusApiClient, type FetchLike, type RivusApiClient } from './api';
import { authenticate } from './auth';
import { GREETING, lastUserMessage } from './conversation';
import { type CompanyField, type Intent, parseIntent } from './intent';
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
	const intent = parseIntent(lastUserMessage(messages) ?? '');
	const session = await authenticate(request, env.JWT_SECRET);

	// Conversational intents need no data and work signed in or out.
	if (intent.kind === 'greeting') {
		return greetingReply(session?.claims ?? null);
	}
	if (intent.kind === 'help') {
		return helpReply(session?.claims ?? null);
	}
	if (intent.kind === 'unknown') {
		return unknownReply(session?.claims ?? null);
	}

	// Everything below is gated on a valid session.
	if (!session) {
		return SIGN_IN_REQUIRED;
	}
	if (!env.RIVUS_API_URL) {
		return NOT_CONFIGURED;
	}
	const api = createRivusApiClient(env.RIVUS_API_URL, session.token, fetchImpl);

	try {
		switch (intent.kind) {
			case 'company_info':
				return await companyInfoReply(api, intent.fields);
			case 'faq_list':
				return await faqListReply(api);
			case 'faq_search':
				return await faqSearchReply(api, intent.query);
			case 'faq_update':
				return await faqUpdateReply(api, intent);
			case 'faq_create':
				return await faqCreateReply(api, intent);
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

async function faqSearchReply(api: RivusApiClient, query: string): Promise<string> {
	const { data, meta } = await api.listFaqs({ page: 1, pageSize: FAQ_SCAN_PAGE_SIZE });
	if (meta.total === 0) {
		return EMPTY_KB;
	}
	const ranked = rankFaqs(data, query);
	if (ranked.length === 0) {
		return `I couldn’t find anything in your knowledge base about “${query}”. Try different wording, or ask me to list all your FAQs.`;
	}
	const lines = ranked.slice(0, 3).map((faq) => `• ${faq.question}\n  ${snippet(faq.answer)}`);
	return [`Here’s what I found about “${query}”:`, ...lines].join('\n');
}

async function faqUpdateReply(
	api: RivusApiClient,
	intent: Extract<Intent, { kind: 'faq_update' }>,
): Promise<string> {
	if (intent.topic === '') {
		return 'Which FAQ should I update? Tell me the topic — e.g. “update the FAQ about refunds to say we offer 30-day refunds.”';
	}
	const { data, meta } = await api.listFaqs({ page: 1, pageSize: FAQ_SCAN_PAGE_SIZE });
	if (meta.total === 0) {
		return EMPTY_KB;
	}
	const matches = matchFaqsByTopic(data, intent.topic);
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
		return `The FAQ “${target.question}” currently says:\n  ${snippet(target.answer)}\nWhat should the new answer be?`;
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
	// means we still need the answer before we can file it.
	if (intent.answer === null) {
		return `Got it — the question is “${intent.question}”. What should the answer be?`;
	}
	const parsed = createFaqSchema.safeParse({ question: intent.question, answer: intent.answer });
	if (!parsed.success) {
		return parsed.error.issues[0]?.message ?? 'That FAQ doesn’t look valid — please try again.';
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

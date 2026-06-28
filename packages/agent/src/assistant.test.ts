import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { FetchLike } from './api';
import { respond } from './assistant';
import { GREETING } from './conversation';
import type { ChatMessage, Env } from './types';

const SECRET = 'test-secret-value-1234';
const API_URL = 'https://api.test';

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signToken(payload: Record<string, unknown>, secret = SECRET): Promise<string> {
	const seg = (value: unknown) => base64Url(encoder.encode(JSON.stringify(value)));
	const data = `${seg({ alg: 'HS256', typ: 'JWT' })}.${seg(payload)}`;
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
	return `${data}.${base64Url(signature)}`;
}

let TOKEN: string;
beforeAll(async () => {
	TOKEN = await signToken({
		sub: 'user_1',
		email: 'owner@acme.example',
		accountId: 'acct_1',
		role: 'owner',
		exp: Math.floor(Date.now() / 1000) + 3600,
	});
});

const user = (content: string): ChatMessage => ({ role: 'user', content });

function makeAccount(over: Partial<Record<string, string>> = {}) {
	return {
		id: 'acct_1',
		name: 'Acme Plumbing',
		slug: 'acme-plumbing',
		phone: '+1 206 555 0100',
		address: '1 Main St',
		website: 'https://acme.example',
		timezone: 'America/Los_Angeles',
		status: 'active',
		canceledAt: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...over,
	};
}

function sessionBody(account = makeAccount()) {
	return {
		user: {
			id: 'user_1',
			email: 'owner@acme.example',
			name: 'Pat Owner',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
		},
		account,
		role: 'owner',
	};
}

function makeFaq(over: Partial<Record<string, string>> = {}) {
	return {
		id: 'faq_1',
		accountId: 'acct_1',
		question: 'Do you offer refunds?',
		answer: 'Yes, within 30 days.',
		category: 'Billing',
		status: 'published',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...over,
	};
}

function page(faqs: ReturnType<typeof makeFaq>[], total = faqs.length) {
	return {
		data: faqs,
		meta: {
			page: 1,
			pageSize: 100,
			total,
			totalPages: 1,
			hasNextPage: false,
			hasPreviousPage: false,
		},
	};
}

interface Route {
	when: (url: string, method: string) => boolean;
	body: unknown;
	status?: number;
}

/** A fetch that answers each call from the first matching route (fresh Response). */
function router(routes: Route[]): FetchLike {
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		const route = routes.find((r) => r.when(url, method));
		if (!route) {
			throw new Error(`no mock route for ${method} ${url}`);
		}
		return new Response(JSON.stringify(route.body), {
			status: route.status ?? 200,
			headers: { 'content-type': 'application/json' },
		});
	}) as unknown as FetchLike;
}

const onGetMe: Route['when'] = (url, method) => method === 'GET' && url.endsWith('/v1/auth/me');
const onListFaqs: Route['when'] = (url, method) => method === 'GET' && url.includes('/v1/faqs?');
const onUpdateFaq: Route['when'] = (_url, method) => method === 'PATCH';
const onSimilarFaq: Route['when'] = (url, method) =>
	method === 'POST' && url.endsWith('/v1/faqs/similar');
const onCreateFaq: Route['when'] = (url, method) => method === 'POST' && url.endsWith('/v1/faqs');
const onAnswerFaq: Route['when'] = (url, method) =>
	method === 'POST' && url.endsWith('/v1/faqs/answer');

/** The "knowledge base doesn't cover it" response from /v1/faqs/answer. */
const noAnswer = { answered: false, answer: '', sources: [] };

/** The "no duplicate found" response from /v1/faqs/similar (the common case). */
const noSimilarFaq = { match: null, reason: '', merged: null };

function envWith(over: Partial<Env> = {}): Env {
	return { JWT_SECRET: SECRET, RIVUS_API_URL: API_URL, ...over } as unknown as Env;
}

function anonRequest(): Request {
	return new Request('https://agent.test/chat', { method: 'POST' });
}

function authedRequest(token = TOKEN): Request {
	return new Request('https://agent.test/chat', {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}` },
	});
}

/** Run respond with sensible defaults; pass a token to authenticate. */
function ask(
	content: string,
	opts: { token?: string; fetchImpl?: FetchLike; env?: Env } = {},
): Promise<string> {
	return respond({
		env: opts.env ?? envWith(),
		request: opts.token ? authedRequest(opts.token) : anonRequest(),
		messages: content === '' ? [] : [user(content)],
		fetchImpl: opts.fetchImpl,
	});
}

describe('respond — conversational', () => {
	it('greets an anonymous caller and nudges them to sign in', async () => {
		const reply = await ask('');
		expect(reply).toContain(GREETING);
		expect(reply).toMatch(/sign in/i);
	});

	it('greets a signed-in caller by email', async () => {
		const reply = await ask('hi', { token: TOKEN });
		expect(reply).toContain('owner@acme.example');
	});

	it('explains its capabilities for help', async () => {
		const anon = await ask('what can you do?');
		expect(anon).toMatch(/knowledge base/i);
		expect(anon).toMatch(/sign in first/i);

		const authed = await ask('help', { token: TOKEN });
		expect(authed).toMatch(/company details/i);
		expect(authed).not.toMatch(/sign in first/i);
	});

	it('handles an unrelated ask gracefully', async () => {
		const anon = await ask('what is the meaning of life');
		expect(anon).toContain(GREETING);

		// Signed in, the agent tries the knowledge base first; when it doesn't cover
		// the question it falls back to the same friendly nudge.
		const authed = await ask('what is the meaning of life', {
			token: TOKEN,
			fetchImpl: router([{ when: onAnswerFaq, body: noAnswer }]),
		});
		expect(authed).toMatch(/not sure how to help/i);
	});
});

describe('respond — knowledge base answering', () => {
	it('answers a general question from the knowledge base and cites the FAQ', async () => {
		// "best price" matches a differently-worded pricing FAQ — the kind of semantic
		// match the AI handles and plain keyword routing misses.
		const reply = await ask("what's our best price?", {
			token: TOKEN,
			fetchImpl: router([
				{
					when: onAnswerFaq,
					body: {
						answered: true,
						answer: 'Our standard rate is $125 an hour, and $85 on weekends.',
						sources: [{ id: 'faq_1', question: 'How much does your service cost?' }],
					},
				},
			]),
		});
		expect(reply).toContain('$125 an hour');
		expect(reply).toContain('How much does your service cost?');
	});

	it('returns just the answer when no source FAQ is given', async () => {
		const reply = await ask('do you charge for travel?', {
			token: TOKEN,
			fetchImpl: router([
				{ when: onAnswerFaq, body: { answered: true, answer: 'No travel fees.', sources: [] } },
			]),
		});
		expect(reply).toBe('No travel fees.');
	});

	it('falls back to the nudge when the knowledge base has no answer', async () => {
		const reply = await ask('what is the airspeed of a swallow?', {
			token: TOKEN,
			fetchImpl: router([{ when: onAnswerFaq, body: noAnswer }]),
		});
		expect(reply).toMatch(/not sure how to help/i);
	});

	it('nudges an anonymous caller to sign in instead of hitting the API', async () => {
		// No fetch route is provided: a signed-out general question must never call the
		// answer endpoint, so it resolves purely from the brush-off path.
		const reply = await ask("what's our best price?");
		expect(reply).toContain(GREETING);
		expect(reply).toMatch(/signed in/i);
	});

	it('surfaces an API failure during answering', async () => {
		const reply = await ask("what's our best price?", {
			token: TOKEN,
			fetchImpl: router([{ when: onAnswerFaq, body: { message: 'boom' }, status: 500 }]),
		});
		expect(reply).toMatch(/couldn’t reach your Rivus data/i);
	});
});

describe('respond — conversation context (rule-based router)', () => {
	const assistant = (content: string): ChatMessage => ({ role: 'assistant', content });

	it('resolves a bare browse follow-up from the prior knowledge-base turn', async () => {
		// After looking at the FAQs, "show me them" names no subject; context routes it
		// to the list, so the agent shows the knowledge base rather than brushing it off.
		const reply = await respond({
			env: envWith(),
			request: authedRequest(),
			messages: [
				user('how many faqs do we have?'),
				assistant('Your knowledge base has 3 FAQs: …'),
				user('show me them'),
			],
			fetchImpl: router([{ when: onListFaqs, body: page([makeFaq()]) }]),
		});
		expect(reply).toMatch(/knowledge base has/i);
	});

	it('defers a bare "what should I add?" to the knowledge-answer path, not a create', async () => {
		// Creating an FAQ isn't inferred from context, so this flows to the AI answer
		// path and degrades to the friendly nudge when the KB has nothing — it does not
		// jump straight into "add an FAQ".
		const reply = await respond({
			env: envWith(),
			request: authedRequest(),
			messages: [
				user('how many faqs do we have?'),
				assistant('Your knowledge base has 3 FAQs: …'),
				user('What should I add?'),
			],
			fetchImpl: router([{ when: onAnswerFaq, body: noAnswer }]),
		});
		expect(reply).toMatch(/not sure how to help/i);
		expect(reply).not.toMatch(/what question should the FAQ answer/i);
	});
});

describe('respond — model-routed decisions', () => {
	it('adds an FAQ when the model decides the user wants to create one', async () => {
		// The model router resolves a bare "what should I add?" to a create; the agent
		// then helps add one. (faq_create with no parts replies straight away.)
		const reply = await respond({
			env: envWith(),
			request: authedRequest(),
			messages: [user('What should I add?')],
			decide: async () => ({ kind: 'faq_create', question: null, answer: null }),
		});
		expect(reply).toMatch(/what question should the FAQ answer/i);
	});

	it('answers from the knowledge base when the model reads a create-word as a question', async () => {
		// "How do I create an invoice?" contains "create" but is a question; the model
		// routes it to faq_answer, so it's answered from the FAQs, not turned into one.
		const faqs = [
			makeFaq({ question: 'Creating invoices', answer: 'Open Billing → New invoice.' }),
		];
		const reply = await respond({
			env: envWith(),
			request: authedRequest(),
			messages: [user('How do I create an invoice?')],
			decide: async () => ({ kind: 'faq_answer', question: 'How do I create an invoice?' }),
			fetchImpl: router([
				{
					when: onAnswerFaq,
					body: {
						answered: true,
						answer: 'Open Billing, then New invoice.',
						sources: [{ id: faqs[0]?.id, question: faqs[0]?.question }],
					},
				},
			]),
		});
		expect(reply).toMatch(/open billing/i);
		expect(reply).toMatch(/from your faq/i);
	});

	it('falls back to the rule-based router when no model and no decide override', async () => {
		// Default deps, no ANTHROPIC_API_KEY: a clear ask still routes deterministically.
		const reply = await respond({
			env: envWith(),
			request: authedRequest(),
			messages: [user('what is our website?')],
			fetchImpl: router([{ when: onGetMe, body: sessionBody() }]),
		});
		expect(reply).toMatch(/your website is/i);
	});

	it('never routes an unauthenticated caller through the model', async () => {
		// An anonymous request must not send its transcript to a paid third-party model:
		// it's routed deterministically and nudged to sign in, the router untouched.
		const decide = vi.fn(async () => ({ kind: 'faq_list' as const }));
		const reply = await respond({
			env: envWith(),
			request: anonRequest(),
			messages: [user('what is our website?')],
			decide,
		});
		expect(decide).not.toHaveBeenCalled();
		expect(reply).toMatch(/signed in/i);
	});

	it('does not route an empty open through the model (just greets)', async () => {
		// The app posts an empty transcript on open to fetch the greeting — no model call.
		const decide = vi.fn(async () => ({ kind: 'faq_list' as const }));
		const reply = await respond({
			env: envWith(),
			request: authedRequest(),
			messages: [],
			decide,
		});
		expect(decide).not.toHaveBeenCalled();
		expect(reply).toContain(GREETING);
	});
});

describe('respond — auth gating', () => {
	it('requires sign-in for protected asks', async () => {
		const reply = await ask('what is our website?');
		expect(reply).toMatch(/signed in/i);
	});

	it('reports when the API is not configured', async () => {
		const reply = await ask('what is our website?', {
			token: TOKEN,
			env: envWith({ RIVUS_API_URL: undefined }),
		});
		expect(reply).toMatch(/fully configured/i);
	});
});

describe('respond — company info', () => {
	it('answers a specific field', async () => {
		const reply = await ask('what is our website?', {
			token: TOKEN,
			fetchImpl: router([{ when: onGetMe, body: sessionBody() }]),
		});
		expect(reply).toBe('Your website is https://acme.example.');
	});

	it('explains when a field is not set yet', async () => {
		const reply = await ask('what is our website?', {
			token: TOKEN,
			fetchImpl: router([{ when: onGetMe, body: sessionBody(makeAccount({ website: '' })) }]),
		});
		expect(reply).toMatch(/haven’t added a website/i);
	});

	it('summarizes the whole record for a generic ask, showing blanks', async () => {
		const reply = await ask('tell me about my business', {
			token: TOKEN,
			fetchImpl: router([{ when: onGetMe, body: sessionBody(makeAccount({ phone: '' })) }]),
		});
		expect(reply).toContain('Acme Plumbing');
		expect(reply).toContain('Website: https://acme.example');
		expect(reply).toContain('Phone: not set');
	});
});

describe('respond — knowledge base reads', () => {
	it('lists FAQs', async () => {
		const faqs = [makeFaq(), makeFaq({ id: 'faq_2', question: 'Where are you located?' })];
		const reply = await ask('list our faqs', {
			token: TOKEN,
			fetchImpl: router([{ when: onListFaqs, body: page(faqs) }]),
		});
		expect(reply).toContain('has 2 FAQs');
		expect(reply).toContain('Do you offer refunds?');
		expect(reply).toContain('Where are you located?');
	});

	it('uses the singular for a single FAQ', async () => {
		const reply = await ask('show me the knowledge base', {
			token: TOKEN,
			fetchImpl: router([{ when: onListFaqs, body: page([makeFaq()]) }]),
		});
		expect(reply).toContain('has 1 FAQ:');
	});

	it('notes how many more FAQs exist beyond the first ten', async () => {
		const faqs = Array.from({ length: 12 }, (_, i) =>
			makeFaq({ id: `faq_${i}`, question: `Question ${i}?` }),
		);
		const reply = await ask('list faqs', {
			token: TOKEN,
			fetchImpl: router([{ when: onListFaqs, body: page(faqs) }]),
		});
		expect(reply).toMatch(/and 2 more/i);
	});

	it('reports an empty knowledge base', async () => {
		const reply = await ask('list faqs', {
			token: TOKEN,
			fetchImpl: router([{ when: onListFaqs, body: page([]) }]),
		});
		expect(reply).toMatch(/knowledge base is empty/i);
	});

	it('searches and ranks by relevance', async () => {
		const faqs = [
			makeFaq({
				id: 'faq_1',
				question: 'What is your refund policy?',
				answer: 'Refunds in 30 days.',
			}),
			makeFaq({ id: 'faq_2', question: 'Where are you located?', answer: 'Seattle.' }),
		];
		const reply = await ask('search the FAQ for refund', {
			token: TOKEN,
			fetchImpl: router([{ when: onListFaqs, body: page(faqs) }]),
		});
		expect(reply).toMatch(/found about “refund”/i);
		expect(reply).toContain('What is your refund policy?');
		expect(reply).not.toContain('Where are you located?');
	});

	it('falls back to a substring match for a short query', async () => {
		const faqs = [makeFaq({ question: 'What are your HR policies?', answer: 'See the handbook.' })];
		const reply = await ask('do we have an faq about hr', {
			token: TOKEN,
			fetchImpl: router([{ when: onListFaqs, body: page(faqs) }]),
		});
		expect(reply).toContain('What are your HR policies?');
	});

	it('matches accented (non-ASCII) search terms', async () => {
		const faqs = [makeFaq({ question: 'Café opening hours?', answer: 'We open at 8am.' })];
		const reply = await ask('search faqs for café', {
			token: TOKEN,
			fetchImpl: router([{ when: onListFaqs, body: page(faqs) }]),
		});
		expect(reply).toContain('Café opening hours?');
	});

	it('says when a search finds nothing', async () => {
		const reply = await ask('search faqs for skydiving', {
			token: TOKEN,
			fetchImpl: router([{ when: onListFaqs, body: page([makeFaq()]) }]),
		});
		expect(reply).toMatch(/couldn’t find anything/i);
	});

	it('truncates a very long answer in results', async () => {
		const longAnswer = `${'x'.repeat(400)} END`;
		const faqs = [makeFaq({ question: 'Refund policy?', answer: longAnswer })];
		const reply = await ask('search faqs for refund', {
			token: TOKEN,
			fetchImpl: router([{ when: onListFaqs, body: page(faqs) }]),
		});
		expect(reply).toContain('…');
		expect(reply).not.toContain('END');
	});
});

describe('respond — knowledge base writes', () => {
	it('updates a matched FAQ with a new answer', async () => {
		const faqs = [makeFaq({ question: 'What is your return policy?' })];
		const reply = await ask('update the faq about return to say we accept returns within 14 days', {
			token: TOKEN,
			fetchImpl: router([
				{ when: onListFaqs, body: page(faqs) },
				{
					when: onUpdateFaq,
					body: makeFaq({
						question: 'What is your return policy?',
						answer: 'we accept returns within 14 days',
					}),
				},
			]),
		});
		expect(reply).toMatch(/Done — I updated/i);
		expect(reply).toContain('we accept returns within 14 days');
	});

	it('asks what to change when only a topic is given', async () => {
		const faqs = [makeFaq({ question: 'What is your return policy?', answer: 'Old answer.' })];
		const reply = await ask('change the faq about return', {
			token: TOKEN,
			fetchImpl: router([{ when: onListFaqs, body: page(faqs) }]),
		});
		expect(reply).toMatch(/currently says/i);
		// Stateless: it asks for the whole instruction in one message, not a follow-up.
		expect(reply).toMatch(/in one message/i);
		expect(reply).toMatch(/to say/i);
	});

	it('asks which FAQ when several match', async () => {
		const faqs = [
			makeFaq({ id: 'faq_1', question: 'What is your return policy?' }),
			makeFaq({ id: 'faq_2', question: 'How do I start a return?' }),
		];
		const reply = await ask('update the faq about return to say see our policy page', {
			token: TOKEN,
			fetchImpl: router([{ when: onListFaqs, body: page(faqs) }]),
		});
		expect(reply).toMatch(/which one/i);
		expect(reply).toContain('What is your return policy?');
		expect(reply).toContain('How do I start a return?');
	});

	it('says when no FAQ matches the topic', async () => {
		const reply = await ask('update the faq about parking to say there is none', {
			token: TOKEN,
			fetchImpl: router([{ when: onListFaqs, body: page([makeFaq()]) }]),
		});
		expect(reply).toMatch(/couldn’t find an FAQ about “parking”/i);
	});

	it('asks for a topic when an update names none', async () => {
		const reply = await ask('update an faq', { token: TOKEN, fetchImpl: router([]) });
		expect(reply).toMatch(/which faq should i update/i);
	});

	it('reports an empty knowledge base on update', async () => {
		const reply = await ask('update the faq about return to say hello', {
			token: TOKEN,
			fetchImpl: router([{ when: onListFaqs, body: page([]) }]),
		});
		expect(reply).toMatch(/knowledge base is empty/i);
	});

	it('rejects an invalid (too long) answer before calling the API', async () => {
		const faqs = [makeFaq({ question: 'What is your return policy?' })];
		const huge = 'y'.repeat(4001);
		const reply = await ask(`update the faq about return to say ${huge}`, {
			token: TOKEN,
			fetchImpl: router([{ when: onListFaqs, body: page(faqs) }]),
		});
		expect(reply).toMatch(/4000 characters or fewer/i);
	});

	it('creates an FAQ from an explicit question and answer', async () => {
		const reply = await ask('add an faq question: Do you ship? answer: Yes, nationwide.', {
			token: TOKEN,
			fetchImpl: router([
				{ when: onSimilarFaq, body: noSimilarFaq },
				{
					when: onCreateFaq,
					body: makeFaq({ question: 'Do you ship?', answer: 'Yes, nationwide.' }),
				},
			]),
		});
		expect(reply).toMatch(/Added a new FAQ/i);
		expect(reply).toContain('Do you ship?');
	});

	it('warns instead of creating a duplicate FAQ', async () => {
		const existing = makeFaq({ question: 'Do you ship nationwide?', answer: 'Yes.' });
		const reply = await ask('add an faq question: Do you ship? answer: Yes, nationwide.', {
			token: TOKEN,
			fetchImpl: router([
				{ when: onSimilarFaq, body: { match: existing, reason: 'same topic', merged: null } },
				// createFaq must NOT be called — there's no route for it, so a call would throw.
			]),
		});
		expect(reply).toMatch(/looks a lot like an existing FAQ/i);
		expect(reply).toContain('Do you ship nationwide?');
	});

	it('asks for the answer when only a question is given', async () => {
		const reply = await ask('create a new faq about warranty', {
			token: TOKEN,
			fetchImpl: router([]),
		});
		expect(reply).toMatch(/in one message/i);
		expect(reply).toMatch(/warranty/i);
	});

	it('creates an FAQ from a quoted title and a trailing-sentence answer', async () => {
		// The phrasing a user actually typed: a quoted title plus a follow-on
		// sentence as the answer — previously this fell through to "tell me both".
		const reply = await ask(
			'add this FAQ. "Our Cancelation Policy". It needs to be 24 hour in advance',
			{
				token: TOKEN,
				fetchImpl: router([
					{ when: onSimilarFaq, body: noSimilarFaq },
					{
						when: onCreateFaq,
						body: makeFaq({
							question: 'Our Cancelation Policy',
							answer: 'It needs to be 24 hour in advance',
						}),
					},
				]),
			},
		);
		expect(reply).toMatch(/Added a new FAQ/i);
		expect(reply).toContain('Our Cancelation Policy');
	});

	it('asks only for the answer when a quoted title arrives without one', async () => {
		const reply = await ask('add a faq "Do you deliver?"', {
			token: TOKEN,
			fetchImpl: router([]),
		});
		expect(reply).toMatch(/in one message/i);
		expect(reply).toContain('Do you deliver?');
	});

	it('searches every page of a large knowledge base before reporting a miss', async () => {
		// Page 1 is full and signals more; the match lives on page 2. A single-page
		// scan would wrongly report "nothing found".
		const filler = Array.from({ length: 100 }, (_, i) =>
			makeFaq({ id: `f${i}`, question: `Filler ${i}?`, answer: 'n/a' }),
		);
		const target = makeFaq({ id: 'target', question: 'What is your refund policy?', answer: 'X.' });
		const firstPage = page(filler);
		const fetchImpl = router([
			{
				when: (url, method) => method === 'GET' && url.includes('page=1'),
				body: { data: filler, meta: { ...firstPage.meta, hasNextPage: true } },
			},
			{ when: (url, method) => method === 'GET' && url.includes('page=2'), body: page([target]) },
		]);
		const reply = await ask('search faqs for refund', { token: TOKEN, fetchImpl });
		expect(reply).toContain('What is your refund policy?');
	});

	it('asks for both parts when neither is given', async () => {
		const reply = await ask('add a faq', { token: TOKEN, fetchImpl: router([]) });
		expect(reply).toMatch(/what question should the FAQ answer/i);
	});

	it('rejects an invalid (too long) new question before calling the API', async () => {
		const longQuestion = 'q'.repeat(301);
		const reply = await ask(`add an faq question: ${longQuestion} answer: short`, {
			token: TOKEN,
			fetchImpl: router([]),
		});
		expect(reply).toMatch(/300 characters or fewer/i);
	});
});

describe('respond — API error handling', () => {
	it('explains an expired session (401)', async () => {
		const reply = await ask('what is our website?', {
			token: TOKEN,
			fetchImpl: router([{ when: onGetMe, body: { message: 'nope' }, status: 401 }]),
		});
		expect(reply).toMatch(/session looks like it expired/i);
	});

	it('explains a permission error (403)', async () => {
		const faqs = [makeFaq({ question: 'What is your return policy?' })];
		const reply = await ask('update the faq about return to say new answer', {
			token: TOKEN,
			fetchImpl: router([
				{ when: onListFaqs, body: page(faqs) },
				{ when: onUpdateFaq, body: { message: 'forbidden' }, status: 403 },
			]),
		});
		expect(reply).toMatch(/don’t have permission/i);
	});

	it('handles an unexpected API failure (500)', async () => {
		const reply = await ask('search faqs for refund', {
			token: TOKEN,
			fetchImpl: router([{ when: onListFaqs, body: { message: 'boom' }, status: 500 }]),
		});
		expect(reply).toMatch(/couldn’t reach your Rivus data/i);
	});
});

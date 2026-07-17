import type { Faq, FaqId } from '@rivus/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../src/plugins/auth';
import { GREETING } from '../src/services/chat/conversation';
import type { Decide } from '../src/services/chat/decide';
import type { FaqAnswer, FaqAnswerService } from '../src/services/faq-answer';
import type {
	FaqMergeSuggestion,
	FaqSimilarityMatch,
	FaqSimilarityService,
} from '../src/services/faq-similarity';
import { authHeader, buildTestApp, buildTestAppWithRepos, signupOwner } from './helpers';

/**
 * Route-level tests for `POST /v1/chat` — the in-process successor to the
 * standalone agent. The scenarios (and expected replies) are ported from the
 * agent's `assistant.test.ts`, re-grounded on `app.inject()` + the in-memory
 * repositories instead of a mocked HTTP API, so they pin the migration's
 * reply-parity promise — especially that anonymous and no-longer-valid sessions
 * get conversational replies, never a 401.
 */

const apps: FastifyInstance[] = [];
afterEach(async () => {
	await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function makeApp(...args: Parameters<typeof buildTestApp>): Promise<FastifyInstance> {
	const app = await buildTestApp(...args);
	apps.push(app);
	return app;
}

/** POST a conversation; returns the parsed body and status. */
async function chat(
	app: FastifyInstance,
	content: string | null,
	opts: { token?: string; cookie?: string } = {},
): Promise<{ status: number; reply: string }> {
	const response = await app.inject({
		method: 'POST',
		url: '/v1/chat',
		headers: {
			...(opts.token ? authHeader(opts.token) : {}),
			...(opts.cookie ? { cookie: `${SESSION_COOKIE}=${opts.cookie}` } : {}),
		},
		payload: { messages: content === null ? [] : [{ role: 'user', content }] },
	});
	const body = response.json<{ reply?: string }>();
	return { status: response.statusCode, reply: body.reply ?? '' };
}

/** Create an FAQ through the real route, returning its id. */
async function seedFaq(
	app: FastifyInstance,
	token: string,
	over: Partial<{ question: string; answer: string; category: string; status: string }> = {},
): Promise<FaqId> {
	const response = await app.inject({
		method: 'POST',
		url: '/v1/faqs',
		headers: authHeader(token),
		payload: {
			question: 'Do you offer refunds?',
			answer: 'Yes, within 30 days.',
			category: 'Billing',
			...over,
		},
	});
	expect(response.statusCode).toBe(201);
	return response.json<{ id: FaqId }>().id;
}

/** An answering service scripted per test (the Noop default answers nothing). */
function answering(result: FaqAnswer): FaqAnswerService & { candidates: Faq[][] } {
	const candidates: Faq[][] = [];
	return {
		candidates,
		async answer(_input, faqs) {
			candidates.push(faqs);
			return result;
		},
	};
}

/** A similarity service that always reports `match` (null = no duplicate). */
function similarity(match: (faqs: { id: FaqId }) => FaqSimilarityMatch | null): {
	forFaq(id: FaqId): FaqSimilarityService;
} {
	return {
		forFaq(id) {
			return {
				async findSimilar() {
					return match({ id });
				},
				async mergeSuggestion(): Promise<FaqMergeSuggestion> {
					return { question: '', answer: '' };
				},
			};
		},
	};
}

describe('GET /v1/chat', () => {
	it('returns the greeting with no auth (the browser smoke test)', async () => {
		const app = await makeApp();
		const response = await app.inject({ method: 'GET', url: '/v1/chat' });
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ reply: GREETING });
	});
});

describe('POST /v1/chat — anonymous callers are conversational, never 401', () => {
	it('greets an empty open and nudges toward sign-in', async () => {
		const app = await makeApp();
		const { status, reply } = await chat(app, null);
		expect(status).toBe(200);
		expect(reply).toContain(GREETING);
		expect(reply).toMatch(/sign in/i);
	});

	it('treats an invalid token as anonymous rather than rejecting the request', async () => {
		const app = await makeApp();
		const { status, reply } = await chat(app, 'what is our website?', { token: 'not-a-jwt' });
		expect(status).toBe(200);
		expect(reply).toMatch(/signed in/i);
	});

	it('explains its capabilities, with a sign-in coda when signed out', async () => {
		const app = await makeApp();
		const { reply } = await chat(app, 'what can you do?');
		expect(reply).toMatch(/knowledge base/i);
		expect(reply).toMatch(/sign in first/i);
	});

	it('nudges instead of erroring on a protected ask', async () => {
		const app = await makeApp();
		const { status, reply } = await chat(app, 'what is our website?');
		expect(status).toBe(200);
		expect(reply).toMatch(/signed in/i);
	});

	it('handles an unrelated question with the friendly brush-off', async () => {
		const app = await makeApp();
		const { reply } = await chat(app, 'what is the meaning of life');
		expect(reply).toContain(GREETING);
	});

	it('never routes an anonymous transcript through the decider (no model calls)', async () => {
		const decide = vi.fn<Decide>(async () => ({ kind: 'faq_list' }));
		const app = await makeApp({ chatDecider: decide });
		const { reply } = await chat(app, 'what is our website?');
		expect(decide).not.toHaveBeenCalled();
		expect(reply).toMatch(/signed in/i);
	});

	it('accepts the single-message shorthand', async () => {
		const app = await makeApp();
		const response = await app.inject({
			method: 'POST',
			url: '/v1/chat',
			payload: { message: 'hi' },
		});
		expect(response.statusCode).toBe(200);
		expect(response.json<{ reply: string }>().reply).toContain(GREETING);
	});

	it('rejects a malformed transcript with a 400 (schema-validated)', async () => {
		const app = await makeApp();
		const response = await app.inject({
			method: 'POST',
			url: '/v1/chat',
			payload: { messages: 'not-an-array' },
		});
		expect(response.statusCode).toBe(400);
	});
});

describe('POST /v1/chat — sessions', () => {
	it('greets a signed-in caller by email (bearer)', async () => {
		const app = await makeApp();
		const { token, credentials } = await signupOwner(app);
		const { reply } = await chat(app, 'hi', { token });
		expect(reply).toContain(credentials.email);
	});

	it('authenticates via the session cookie exactly like the rest of the API', async () => {
		const app = await makeApp();
		const { token, credentials } = await signupOwner(app);
		const { reply } = await chat(app, 'hi', { cookie: token });
		expect(reply).toContain(credentials.email);
	});

	it('does not spend a decider call on an empty signed-in open', async () => {
		const decide = vi.fn<Decide>(async () => ({ kind: 'faq_list' }));
		const app = await makeApp({ chatDecider: decide });
		const { token } = await signupOwner(app);
		const { reply } = await chat(app, null, { token });
		expect(decide).not.toHaveBeenCalled();
		expect(reply).toContain(GREETING);
	});

	it('replies "sign in again" — not a 401 — when the session no longer revalidates', async () => {
		// Cancel the account after sign-in: the token still verifies, but the session
		// fails the same DB revalidation `authenticate` applies. The standalone agent
		// surfaced this via the API's 401 as a friendly sentence; the route must too.
		const app = await makeApp();
		const { token } = await signupOwner(app);
		const canceled = await app.inject({
			method: 'POST',
			url: '/v1/account/cancel',
			headers: authHeader(token),
		});
		expect(canceled.statusCode).toBe(200);
		const { status, reply } = await chat(app, 'what is our website?', { token });
		expect(status).toBe(200);
		expect(reply).toMatch(/session looks like it expired/i);
	});
});

describe('POST /v1/chat — company info', () => {
	it('answers a specific field once it is set', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		await app.inject({
			method: 'PATCH',
			url: '/v1/account',
			headers: authHeader(token),
			payload: { website: 'https://acme.example' },
		});
		const { reply } = await chat(app, 'what is our website?', { token });
		expect(reply).toBe('Your website is https://acme.example.');
	});

	it('explains when a field is not set yet', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		const { reply } = await chat(app, 'what is our website?', { token });
		expect(reply).toMatch(/haven’t added a website/i);
	});

	it('summarizes the whole record for a generic ask, showing blanks', async () => {
		const app = await makeApp();
		const { token, account } = await signupOwner(app);
		const { reply } = await chat(app, 'tell me about my business', { token });
		expect(reply).toContain(account.name);
		expect(reply).toContain('Phone: not set');
	});
});

describe('POST /v1/chat — knowledge base reads', () => {
	it('lists FAQs (plural, with titles)', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		await seedFaq(app, token);
		await seedFaq(app, token, { question: 'Where are you located?', answer: 'Seattle.' });
		const { reply } = await chat(app, 'list our faqs', { token });
		expect(reply).toContain('has 2 FAQs');
		expect(reply).toContain('Do you offer refunds?');
		expect(reply).toContain('Where are you located?');
	});

	it('uses the singular for a single FAQ', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		await seedFaq(app, token);
		const { reply } = await chat(app, 'show me the knowledge base', { token });
		expect(reply).toContain('has 1 FAQ:');
	});

	it('notes how many more FAQs exist beyond the first ten', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		for (let i = 0; i < 12; i++) {
			await seedFaq(app, token, { question: `Question ${i}?`, answer: 'n/a' });
		}
		const { reply } = await chat(app, 'list faqs', { token });
		expect(reply).toMatch(/and 2 more/i);
	});

	it('reports an empty knowledge base', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		const { reply } = await chat(app, 'list faqs', { token });
		expect(reply).toMatch(/knowledge base is empty/i);
	});

	it('answers a general question from the knowledge base and cites the FAQ', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		await seedFaq(app, token, { question: 'How much does your service cost?', answer: '$125/hr.' });
		// Swap in a scripted answering service for this app instance.
		app.deps.faqAnswer = answering({
			answered: true,
			answer: 'Our standard rate is $125 an hour, and $85 on weekends.',
			sources: [],
		});
		const { reply } = await chat(app, "what's our best price?", { token });
		expect(reply).toContain('$125 an hour');
	});

	it('grounds answers only in published FAQs (drafts are invisible)', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		await seedFaq(app, token, { question: 'Published?', answer: 'Yes.' });
		await seedFaq(app, token, {
			question: 'Secret draft?',
			answer: 'Unreleased.',
			status: 'draft',
		});
		const service = answering({ answered: false, answer: '', sources: [] });
		app.deps.faqAnswer = service;
		await chat(app, 'what do you charge?', { token });
		const seen = service.candidates.flat().map((faq) => faq.question);
		expect(seen).toContain('Published?');
		expect(seen).not.toContain('Secret draft?');
	});

	it('cites the source FAQ when the answering service names one', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		const id = await seedFaq(app, token, {
			question: 'How much does your service cost?',
			answer: '$125/hr.',
		});
		app.deps.faqAnswer = answering({
			answered: true,
			answer: 'Our standard rate is $125 an hour.',
			sources: [id],
		});
		const { reply } = await chat(app, "what's our best price?", { token });
		expect(reply).toContain('(From your FAQ “How much does your service cost?”.)');
	});

	it('falls back to the friendly nudge when the knowledge base has no answer', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		const { reply } = await chat(app, 'what is the airspeed of a swallow?', { token });
		expect(reply).toMatch(/not sure how to help/i);
	});

	it('falls back to the keyword list when a search has no grounded answer', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		await seedFaq(app, token, {
			question: 'What is your refund policy?',
			answer: 'Refunds in 30 days.',
		});
		await seedFaq(app, token, { question: 'Where are you located?', answer: 'Seattle.' });
		// Script "no grounded answer" — the default no-key service still keyword-answers.
		app.deps.faqAnswer = answering({ answered: false, answer: '', sources: [] });
		const { reply } = await chat(app, 'search the FAQ for refund', { token });
		expect(reply).toMatch(/found about “refund”/i);
		expect(reply).toContain('What is your refund policy?');
		expect(reply).not.toContain('Where are you located?');
	});

	it('keeps an existence check on the list instead of a synthesized answer', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		await seedFaq(app, token, {
			question: 'What is your refund policy?',
			answer: 'Refunds in 30 days.',
		});
		// If the existence check wrongly hit the answering service, this would surface.
		app.deps.faqAnswer = answering({ answered: true, answer: 'SHOULD NOT APPEAR', sources: [] });
		const { reply } = await chat(app, 'do we have an FAQ about refunds?', { token });
		expect(reply).toContain('What is your refund policy?');
		expect(reply).not.toContain('SHOULD NOT APPEAR');
	});

	it('matches accented (non-ASCII) search terms', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		await seedFaq(app, token, { question: 'Café opening hours?', answer: 'We open at 8am.' });
		const { reply } = await chat(app, 'search faqs for café', { token });
		expect(reply).toContain('Café opening hours?');
	});

	it('says when a search finds nothing', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		await seedFaq(app, token);
		const { reply } = await chat(app, 'search faqs for skydiving', { token });
		expect(reply).toMatch(/couldn’t find anything/i);
	});

	it('truncates a very long answer in results', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		await seedFaq(app, token, { question: 'Refund policy?', answer: `${'x'.repeat(400)} END` });
		// Force the keyword-list path (the default no-key service would answer whole).
		app.deps.faqAnswer = answering({ answered: false, answer: '', sources: [] });
		const { reply } = await chat(app, 'search faqs for refund', { token });
		expect(reply).toContain('…');
		expect(reply).not.toContain('END');
	});

	it('scans every page of a large knowledge base before reporting a miss', async () => {
		// The target is created first, then 100 fillers — newest-first paging puts it
		// on page 2, so a single-page scan would wrongly report "nothing found".
		const { app, repos } = await buildTestAppWithRepos();
		apps.push(app);
		const { token, account } = await signupOwner(app);
		await repos.faqs.create(account.id, {
			question: 'What is your refund policy?',
			answer: 'X.',
			category: '',
			status: 'published',
		});
		for (let i = 0; i < 100; i++) {
			await repos.faqs.create(account.id, {
				question: `Filler ${i}?`,
				answer: 'n/a',
				category: '',
				status: 'published',
			});
		}
		const { reply } = await chat(app, 'search faqs for refund', { token });
		expect(reply).toContain('What is your refund policy?');
	});
});

describe('POST /v1/chat — knowledge base writes', () => {
	it('updates a matched FAQ and persists the change', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		const id = await seedFaq(app, token, {
			question: 'What is your return policy?',
			answer: 'Old.',
		});
		const { reply } = await chat(
			app,
			'update the faq about return to say we accept returns within 14 days',
			{ token },
		);
		expect(reply).toMatch(/Done — I updated/i);
		const fetched = await app.inject({
			method: 'GET',
			url: `/v1/faqs/${id}`,
			headers: authHeader(token),
		});
		expect(fetched.json<{ answer: string }>().answer).toBe('we accept returns within 14 days');
	});

	it('asks what to change when only a topic is given', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		await seedFaq(app, token, { question: 'What is your return policy?', answer: 'Old answer.' });
		const { reply } = await chat(app, 'change the faq about return', { token });
		expect(reply).toMatch(/currently says/i);
		expect(reply).toMatch(/in one message/i);
	});

	it('asks which FAQ when several match', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		await seedFaq(app, token, { question: 'What is your return policy?' });
		await seedFaq(app, token, { question: 'How do I start a return?' });
		const { reply } = await chat(app, 'update the faq about return to say see our policy page', {
			token,
		});
		expect(reply).toMatch(/which one/i);
	});

	it('says when no FAQ matches the topic', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		await seedFaq(app, token);
		const { reply } = await chat(app, 'update the faq about parking to say there is none', {
			token,
		});
		expect(reply).toMatch(/couldn’t find an FAQ about “parking”/i);
	});

	it('asks for a topic when an update names none', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		const { reply } = await chat(app, 'update an faq', { token });
		expect(reply).toMatch(/which faq should i update/i);
	});

	it('rejects an over-long replacement answer with the schema message', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		await seedFaq(app, token, { question: 'What is your return policy?' });
		const { reply } = await chat(app, `update the faq about return to say ${'y'.repeat(4001)}`, {
			token,
		});
		expect(reply).toMatch(/4000 characters or fewer/i);
	});

	it('creates an FAQ from an explicit question and answer, and persists it', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		const { reply } = await chat(
			app,
			'add an faq question: Do you ship? answer: Yes, nationwide.',
			{
				token,
			},
		);
		expect(reply).toMatch(/Added a new FAQ/i);
		const list = await app.inject({
			method: 'GET',
			url: '/v1/faqs?page=1&pageSize=20',
			headers: authHeader(token),
		});
		const questions = list.json<{ data: Array<{ question: string }> }>().data;
		expect(questions.some((faq) => faq.question === 'Do you ship?')).toBe(true);
	});

	it('warns instead of creating a duplicate FAQ', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		const id = await seedFaq(app, token, { question: 'Do you ship nationwide?', answer: 'Yes.' });
		app.deps.faqSimilarity = similarity(({ id: faqId }) => ({
			faqId,
			confidence: 0.9,
			reason: 'same topic',
		})).forFaq(id);
		const { reply } = await chat(
			app,
			'add an faq question: Do you ship? answer: Yes, nationwide.',
			{
				token,
			},
		);
		expect(reply).toMatch(/looks a lot like an existing FAQ/i);
		expect(reply).toContain('Do you ship nationwide?');
		const list = await app.inject({
			method: 'GET',
			url: '/v1/faqs?page=1&pageSize=20',
			headers: authHeader(token),
		});
		expect(list.json<{ meta: { total: number } }>().meta.total).toBe(1);
	});

	it('creates an FAQ from a quoted title and a trailing-sentence answer', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		const { reply } = await chat(
			app,
			'add this FAQ. "Our Cancelation Policy". It needs to be 24 hour in advance',
			{ token },
		);
		expect(reply).toMatch(/Added a new FAQ/i);
		expect(reply).toContain('Our Cancelation Policy');
	});

	it('asks for both parts when neither is given', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		const { reply } = await chat(app, 'add a faq', { token });
		expect(reply).toMatch(/what question should the FAQ answer/i);
	});

	it('rejects an over-long new question with the schema message', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		const { reply } = await chat(app, `add an faq question: ${'q'.repeat(301)} answer: short`, {
			token,
		});
		expect(reply).toMatch(/300 characters or fewer/i);
	});
});

describe('POST /v1/chat — model-routed decisions', () => {
	it('uses the injected decider for signed-in turns', async () => {
		const decide = vi.fn<Decide>(async () => ({
			kind: 'faq_create',
			question: null,
			answer: null,
		}));
		const app = await makeApp({ chatDecider: decide });
		const { token } = await signupOwner(app);
		const { reply } = await chat(app, 'What should I add?', { token });
		expect(decide).toHaveBeenCalledOnce();
		expect(reply).toMatch(/what question should the FAQ answer/i);
	});

	it('answers from the knowledge base when the decider reads a create-word as a question', async () => {
		const app = await makeApp({
			chatDecider: async () => ({ kind: 'faq_answer', question: 'How do I create an invoice?' }),
		});
		const { token } = await signupOwner(app);
		app.deps.faqAnswer = answering({
			answered: true,
			answer: 'Open Billing, then New invoice.',
			sources: [],
		});
		const { reply } = await chat(app, 'How do I create an invoice?', { token });
		expect(reply).toMatch(/open billing/i);
	});
});

describe('POST /v1/chat — failure handling', () => {
	it('degrades to the generic reply when an action fails, still a 200', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		app.deps.faqAnswer = {
			async answer(): Promise<FaqAnswer> {
				throw new Error('provider exploded');
			},
		};
		const { status, reply } = await chat(app, 'what do you charge for travel?', { token });
		expect(status).toBe(200);
		expect(reply).toMatch(/couldn’t reach your Rivus data/i);
	});
});

describe('POST /v1/chat — web tools', () => {
	it('nudges an anonymous web search toward sign-in', async () => {
		const app = await makeApp();
		const { status, reply } = await chat(app, 'search the web for pipe prices');
		expect(status).toBe(200);
		expect(reply).toMatch(/signed in/i);
	});

	it('explains when web search is not enabled (the default no-op)', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		const { reply } = await chat(app, 'search the web for pipe prices', { token });
		expect(reply).toMatch(/web search isn’t enabled/i);
	});

	it('explains when browsing is not enabled (the default no-op)', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		const { reply } = await chat(app, 'read https://example.com/pricing', { token });
		expect(reply).toMatch(/web browsing isn’t enabled/i);
	});

	it('lists search results with titles, snippets, and links', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		const queries: string[] = [];
		app.deps.webSearch = {
			enabled: true,
			async search(query) {
				queries.push(query);
				return [
					{
						title: 'Copper price index',
						url: 'https://metals.example/copper',
						description: 'Daily copper pricing.',
					},
					{ title: 'Supplier list', url: 'https://suppliers.example', description: '' },
				];
			},
		};
		const { reply } = await chat(app, 'search the web for copper pipe prices', { token });
		expect(queries).toEqual(['copper pipe prices']);
		expect(reply).toContain('Here’s what I found on the web for “copper pipe prices”');
		expect(reply).toContain('Copper price index — Daily copper pricing.');
		expect(reply).toContain('https://metals.example/copper');
		expect(reply).toContain('• Supplier list\n  https://suppliers.example');
	});

	it('says so when the web search comes back empty', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		app.deps.webSearch = { enabled: true, search: async () => [] };
		const { reply } = await chat(app, 'search the web for gorbleflux', { token });
		expect(reply).toMatch(/came back empty/i);
	});

	it('quotes a browsed page, keeping its markdown line structure', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		const urls: string[] = [];
		app.deps.webBrowse = {
			enabled: true,
			async browse(url) {
				urls.push(url);
				return { url, content: '# Pricing\n\nStarter: $10/mo' };
			},
		};
		const { reply } = await chat(app, 'read https://example.com/pricing please', { token });
		expect(urls).toEqual(['https://example.com/pricing']);
		expect(reply).toContain('Here’s what I found at https://example.com/pricing');
		expect(reply).toContain('# Pricing\n\nStarter: $10/mo');
	});

	it('reports an unreadable page rather than inventing content', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		app.deps.webBrowse = { enabled: true, browse: async (url) => ({ url, content: '   ' }) };
		const { reply } = await chat(app, 'read https://example.com/empty', { token });
		expect(reply).toMatch(/couldn’t find any readable content/i);
	});

	it('degrades to web-specific failure replies when a provider errors, still 200', async () => {
		const app = await makeApp();
		const { token } = await signupOwner(app);
		app.deps.webSearch = {
			enabled: true,
			async search() {
				throw new Error('brave down');
			},
		};
		const search = await chat(app, 'search the web for anything', { token });
		expect(search.status).toBe(200);
		expect(search.reply).toMatch(/couldn’t reach web search/i);

		app.deps.webBrowse = {
			enabled: true,
			async browse() {
				throw new Error('zenrows down');
			},
		};
		const browse = await chat(app, 'read https://example.com/pricing', { token });
		expect(browse.status).toBe(200);
		expect(browse.reply).toMatch(/couldn’t read https:\/\/example\.com\/pricing/i);
	});

	it('refuses a non-web address from a custom decider with guidance', async () => {
		const app = await makeApp({
			chatDecider: async () => ({ kind: 'web_browse', url: 'ftp://example.com/file' }),
		});
		const { token } = await signupOwner(app);
		const { reply } = await chat(app, 'open that file share', { token });
		expect(reply).toMatch(/only open full web addresses/i);
	});
});

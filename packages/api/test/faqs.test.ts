import type { Faq, FaqId } from '@rivus/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FaqAnswer, FaqAnswerService } from '../src/services/faq-answer';
import type { FaqSimilarityService } from '../src/services/faq-similarity';
import { authHeader, buildTestApp, signupOwner } from './helpers';

describe('faqs', () => {
	let app: FastifyInstance;
	let token: string;

	beforeEach(async () => {
		app = await buildTestApp();
		token = (await signupOwner(app)).token;
	});

	afterEach(async () => {
		await app.close();
	});

	async function createFaq(question: string, extra: Record<string, unknown> = {}) {
		return app.inject({
			method: 'POST',
			url: '/v1/faqs',
			headers: authHeader(token),
			payload: { question, answer: 'Because we said so.', ...extra },
		});
	}

	it('requires authentication', async () => {
		const response = await app.inject({ method: 'GET', url: '/v1/faqs' });
		expect(response.statusCode).toBe(401);
	});

	it('creates an FAQ with defaults', async () => {
		const response = await createFaq('Do you offer free estimates?');

		expect(response.statusCode).toBe(201);
		expect(response.json()).toMatchObject({
			question: 'Do you offer free estimates?',
			answer: 'Because we said so.',
			category: '',
			status: 'published',
		});
		expect(response.json().id).toBeTypeOf('string');
	});

	it('keeps a provided category and status', async () => {
		const response = await createFaq('What are your hours?', {
			category: 'Scheduling',
			status: 'draft',
		});

		expect(response.statusCode).toBe(201);
		expect(response.json()).toMatchObject({ category: 'Scheduling', status: 'draft' });
	});

	it('rejects a create with no question (400)', async () => {
		const response = await app.inject({
			method: 'POST',
			url: '/v1/faqs',
			headers: authHeader(token),
			payload: { answer: 'An answer with no question.' },
		});

		expect(response.statusCode).toBe(400);
	});

	it('rejects a create with no answer (400)', async () => {
		const response = await app.inject({
			method: 'POST',
			url: '/v1/faqs',
			headers: authHeader(token),
			payload: { question: 'A question with no answer?' },
		});

		expect(response.statusCode).toBe(400);
	});

	it('lists FAQs newest-first with pagination metadata', async () => {
		await createFaq('one');
		await createFaq('two');
		await createFaq('three');

		const response = await app.inject({
			method: 'GET',
			url: '/v1/faqs?page=1&pageSize=2',
			headers: authHeader(token),
		});

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.data).toHaveLength(2);
		expect(body.meta).toMatchObject({
			page: 1,
			pageSize: 2,
			total: 3,
			totalPages: 2,
			hasNextPage: true,
			hasPreviousPage: false,
		});
		expect(body.data[0].question).toBe('three');
	});

	it('fetches a single FAQ by id', async () => {
		const created = await createFaq('findable');
		const id = created.json().id;

		const response = await app.inject({
			method: 'GET',
			url: `/v1/faqs/${id}`,
			headers: authHeader(token),
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().id).toBe(id);
	});

	it('returns 404 for an unknown id', async () => {
		const response = await app.inject({
			method: 'GET',
			url: '/v1/faqs/does-not-exist',
			headers: authHeader(token),
		});

		expect(response.statusCode).toBe(404);
	});

	it('updates an FAQ', async () => {
		const created = await createFaq('before');
		const id = created.json().id;

		const response = await app.inject({
			method: 'PATCH',
			url: `/v1/faqs/${id}`,
			headers: authHeader(token),
			payload: { status: 'draft' },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({ question: 'before', status: 'draft' });
	});

	it('rejects an empty update (400)', async () => {
		const created = await createFaq('immutable');
		const id = created.json().id;

		const response = await app.inject({
			method: 'PATCH',
			url: `/v1/faqs/${id}`,
			headers: authHeader(token),
			payload: {},
		});

		expect(response.statusCode).toBe(400);
	});

	it('deletes an FAQ, after which it is gone', async () => {
		const created = await createFaq('temporary');
		const id = created.json().id;

		const deleteResponse = await app.inject({
			method: 'DELETE',
			url: `/v1/faqs/${id}`,
			headers: authHeader(token),
		});
		expect(deleteResponse.statusCode).toBe(204);

		const getResponse = await app.inject({
			method: 'GET',
			url: `/v1/faqs/${id}`,
			headers: authHeader(token),
		});
		expect(getResponse.statusCode).toBe(404);
	});

	it('does not leak FAQs across owners', async () => {
		const created = await createFaq('private');
		const id = created.json().id;

		const otherToken = (await signupOwner(app)).token;
		const response = await app.inject({
			method: 'GET',
			url: `/v1/faqs/${id}`,
			headers: authHeader(otherToken),
		});

		expect(response.statusCode).toBe(404);
	});

	it('does not let another owner update an FAQ', async () => {
		const created = await createFaq('private');
		const id = created.json().id;
		const otherToken = (await signupOwner(app)).token;

		const response = await app.inject({
			method: 'PATCH',
			url: `/v1/faqs/${id}`,
			headers: authHeader(otherToken),
			payload: { question: 'hijacked' },
		});

		expect(response.statusCode).toBe(404);
	});

	it('does not let another owner delete an FAQ', async () => {
		const created = await createFaq('private');
		const id = created.json().id;
		const otherToken = (await signupOwner(app)).token;

		const response = await app.inject({
			method: 'DELETE',
			url: `/v1/faqs/${id}`,
			headers: authHeader(otherToken),
		});

		expect(response.statusCode).toBe(404);
	});
});

describe('POST /v1/faqs/similar', () => {
	it('requires authentication', async () => {
		const app = await buildTestApp();
		const response = await app.inject({
			method: 'POST',
			url: '/v1/faqs/similar',
			payload: { question: 'Anything?' },
		});
		expect(response.statusCode).toBe(401);
		await app.close();
	});

	it('rejects a check with no question (400)', async () => {
		const app = await buildTestApp();
		const token = (await signupOwner(app)).token;
		const response = await app.inject({
			method: 'POST',
			url: '/v1/faqs/similar',
			headers: authHeader(token),
			payload: { question: '' },
		});
		expect(response.statusCode).toBe(400);
		await app.close();
	});

	it('reports no duplicate with the default (no-op) service', async () => {
		const app = await buildTestApp();
		const token = (await signupOwner(app)).token;
		await app.inject({
			method: 'POST',
			url: '/v1/faqs',
			headers: authHeader(token),
			payload: { question: 'How much is a service call?', answer: 'It is $89.' },
		});

		const response = await app.inject({
			method: 'POST',
			url: '/v1/faqs/similar',
			headers: authHeader(token),
			payload: { question: 'What does a service call cost?', answer: 'It costs $89.' },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ match: null, reason: '', merged: null });
		await app.close();
	});

	it('returns the matched FAQ and merged suggestion when the AI finds a duplicate', async () => {
		let matchId: string | null = null;
		const stub: FaqSimilarityService = {
			async findSimilar() {
				return matchId
					? { faqId: matchId as FaqId, confidence: 0.9, reason: 'Same pricing question.' }
					: null;
			},
			async mergeSuggestion() {
				return { question: 'Merged question?', answer: 'Merged answer.' };
			},
		};
		const app = await buildTestApp({ faqSimilarity: stub });
		const token = (await signupOwner(app)).token;
		const created = await app.inject({
			method: 'POST',
			url: '/v1/faqs',
			headers: authHeader(token),
			payload: { question: 'How much is a service call?', answer: 'It is $89.' },
		});
		matchId = created.json().id;

		const response = await app.inject({
			method: 'POST',
			url: '/v1/faqs/similar',
			headers: authHeader(token),
			payload: { question: 'What does a service call cost?', answer: 'It costs $89.' },
		});

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.match.id).toBe(matchId);
		expect(body.reason).toBe('Same pricing question.');
		expect(body.merged).toEqual({ question: 'Merged question?', answer: 'Merged answer.' });
		await app.close();
	});

	it('drops a match whose id does not belong to the account', async () => {
		const stub: FaqSimilarityService = {
			async findSimilar() {
				return { faqId: 'ghost-id' as FaqId, confidence: 0.99, reason: 'hallucinated' };
			},
			async mergeSuggestion() {
				return { question: '', answer: '' };
			},
		};
		const app = await buildTestApp({ faqSimilarity: stub });
		const token = (await signupOwner(app)).token;
		await app.inject({
			method: 'POST',
			url: '/v1/faqs',
			headers: authHeader(token),
			payload: { question: 'How much is a service call?', answer: 'It is $89.' },
		});

		const response = await app.inject({
			method: 'POST',
			url: '/v1/faqs/similar',
			headers: authHeader(token),
			payload: { question: 'What does a service call cost?' },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ match: null, reason: '', merged: null });
		await app.close();
	});
});

describe('POST /v1/faqs/answer', () => {
	it('requires authentication', async () => {
		const app = await buildTestApp();
		const response = await app.inject({
			method: 'POST',
			url: '/v1/faqs/answer',
			payload: { question: 'How much do you charge?' },
		});
		expect(response.statusCode).toBe(401);
		await app.close();
	});

	it('rejects an empty question (400)', async () => {
		const app = await buildTestApp();
		const token = (await signupOwner(app)).token;
		const response = await app.inject({
			method: 'POST',
			url: '/v1/faqs/answer',
			headers: authHeader(token),
			payload: { question: '' },
		});
		expect(response.statusCode).toBe(400);
		await app.close();
	});

	it('answers from the knowledge base and cites the source FAQ', async () => {
		// A stub stands in for the AI service: it answers and points at whichever FAQ
		// id the account created, exercising the route's id → question resolution.
		let sourceId: string | null = null;
		const stub: FaqAnswerService = {
			async answer(): Promise<FaqAnswer> {
				return sourceId
					? {
							answered: true,
							answer: 'Our standard rate is $125 an hour, and $85 on weekends.',
							sources: [sourceId as FaqId],
							grounding: 'model',
						}
					: { answered: false, answer: '', sources: [], grounding: 'model' };
			},
		};
		const app = await buildTestApp({ faqAnswer: stub });
		const token = (await signupOwner(app)).token;
		const created = await app.inject({
			method: 'POST',
			url: '/v1/faqs',
			headers: authHeader(token),
			payload: {
				question: 'How much does your service cost?',
				answer: 'our standard rate is 125 an hour and 85 on weekends',
			},
		});
		sourceId = created.json().id;

		const response = await app.inject({
			method: 'POST',
			url: '/v1/faqs/answer',
			headers: authHeader(token),
			payload: { question: "what's our best price?" },
		});

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.answered).toBe(true);
		expect(body.answer).toContain('$125');
		// The cited id is resolved back to its question for the client.
		expect(body.sources).toEqual([{ id: sourceId, question: 'How much does your service cost?' }]);
		await app.close();
	});

	it('reports not-answered when the knowledge base does not cover it', async () => {
		const app = await buildTestApp();
		const token = (await signupOwner(app)).token;
		await app.inject({
			method: 'POST',
			url: '/v1/faqs',
			headers: authHeader(token),
			payload: { question: 'Where are you located?', answer: 'Seattle.' },
		});

		// The default (deterministic) service finds no keyword overlap with this ask.
		const response = await app.inject({
			method: 'POST',
			url: '/v1/faqs/answer',
			headers: authHeader(token),
			payload: { question: 'tell me a joke' },
		});

		expect(response.statusCode).toBe(200);
		// `grounding` is service-internal: the response schema doesn't declare it, so
		// Fastify strips it and the wire shape is unchanged.
		expect(response.json()).toEqual({ answered: false, answer: '', sources: [] });
		await app.close();
	});

	it('drops a cited id that does not belong to the account', async () => {
		const stub: FaqAnswerService = {
			async answer(): Promise<FaqAnswer> {
				return {
					answered: true,
					answer: 'Leaked answer.',
					sources: ['ghost-id' as FaqId],
					grounding: 'model',
				};
			},
		};
		const app = await buildTestApp({ faqAnswer: stub });
		const token = (await signupOwner(app)).token;
		await app.inject({
			method: 'POST',
			url: '/v1/faqs',
			headers: authHeader(token),
			payload: { question: 'How much is a visit?', answer: 'It is $89.' },
		});

		const response = await app.inject({
			method: 'POST',
			url: '/v1/faqs/answer',
			headers: authHeader(token),
			payload: { question: 'price?' },
		});

		expect(response.statusCode).toBe(200);
		const body = response.json();
		// The answer text passes through, but the unknown id is filtered from sources.
		expect(body.answer).toBe('Leaked answer.');
		expect(body.sources).toEqual([]);
		await app.close();
	});

	it('hands the account FAQs to the answering service as candidates', async () => {
		let received: Faq[] = [];
		const stub: FaqAnswerService = {
			async answer(_input, candidates): Promise<FaqAnswer> {
				received = candidates;
				return { answered: false, answer: '', sources: [], grounding: 'model' };
			},
		};
		const app = await buildTestApp({ faqAnswer: stub });
		const token = (await signupOwner(app)).token;
		await app.inject({
			method: 'POST',
			url: '/v1/faqs',
			headers: authHeader(token),
			payload: { question: 'Do you offer refunds?', answer: 'Yes, within 30 days.' },
		});

		await app.inject({
			method: 'POST',
			url: '/v1/faqs/answer',
			headers: authHeader(token),
			payload: { question: 'refund policy?' },
		});

		expect(received).toHaveLength(1);
		expect(received[0]?.question).toBe('Do you offer refunds?');
		await app.close();
	});

	it('never answers from or cites a draft FAQ', async () => {
		let received: Faq[] = [];
		const stub: FaqAnswerService = {
			async answer(_input, candidates): Promise<FaqAnswer> {
				received = candidates;
				// Echo whatever it was given as the source, to prove drafts can't leak.
				const [first] = candidates;
				return first
					? { answered: true, answer: first.answer, sources: [first.id], grounding: 'model' }
					: { answered: false, answer: '', sources: [], grounding: 'model' };
			},
		};
		const app = await buildTestApp({ faqAnswer: stub });
		const token = (await signupOwner(app)).token;
		// A published FAQ and a draft FAQ holding unreleased pricing.
		await app.inject({
			method: 'POST',
			url: '/v1/faqs',
			headers: authHeader(token),
			payload: { question: 'What are your hours?', answer: '9 to 5.', status: 'published' },
		});
		await app.inject({
			method: 'POST',
			url: '/v1/faqs',
			headers: authHeader(token),
			payload: { question: 'Upcoming price?', answer: 'SECRET draft pricing.', status: 'draft' },
		});

		const response = await app.inject({
			method: 'POST',
			url: '/v1/faqs/answer',
			headers: authHeader(token),
			payload: { question: 'price?' },
		});

		expect(response.statusCode).toBe(200);
		// Only the published FAQ is ever handed to the answering service…
		expect(received).toHaveLength(1);
		expect(received[0]?.status).toBe('published');
		// …and the draft's content never appears in the reply.
		expect(response.json().answer).not.toContain('SECRET');
		await app.close();
	});
});

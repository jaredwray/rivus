import type { FaqId } from '@rivus/core';
import { describe, expect, it, vi } from 'vitest';
import { AgentApiError, createRivusApiClient } from './api';

const BASE = 'https://api.test';
const TOKEN = 'header.jwt.signature';

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

/** The url + init of the nth recorded fetch call (throws if it wasn't made). */
function nthCall(
	mock: { mock: { calls: ReadonlyArray<readonly unknown[]> } },
	n: number,
): { url: string; init: RequestInit | undefined } {
	const call = mock.mock.calls[n];
	if (!call) {
		throw new Error(`expected fetch call #${n}`);
	}
	return { url: String(call[0]), init: call[1] as RequestInit | undefined };
}

const account = {
	id: 'acct_1',
	name: 'Acme Plumbing',
	slug: 'acme-plumbing',
	phone: '+1 206 555 0100',
	address: '1 Main St',
	website: 'https://acme.example',
	timezone: 'America/Los_Angeles',
	status: 'active' as const,
	canceledAt: null,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
};

const session = {
	user: {
		id: 'user_1',
		email: 'owner@acme.example',
		name: 'Pat Owner',
		phone: '',
		pendingEmail: '',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
	},
	account,
	role: 'owner' as const,
};

const faq = {
	id: 'faq_1',
	accountId: 'acct_1',
	question: 'Do you offer refunds?',
	answer: 'Yes, within 30 days.',
	category: 'Billing',
	status: 'published' as const,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('createRivusApiClient', () => {
	it('fetches the session, forwarding the bearer token', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse(session));
		const client = createRivusApiClient(BASE, TOKEN, fetch);

		expect(await client.me()).toEqual(session);
		const { url, init } = nthCall(fetch, 0);
		expect(url).toBe(`${BASE}/v1/auth/me`);
		expect(init?.method).toBe('GET');
		expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
	});

	it('normalizes a trailing slash on the base URL', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse(session));
		const client = createRivusApiClient(`${BASE}/`, TOKEN, fetch);
		await client.me();
		expect(nthCall(fetch, 0).url).toBe(`${BASE}/v1/auth/me`);
	});

	it('lists FAQs with default and explicit pagination', async () => {
		const page = { data: [faq], meta: pageMeta(1) };
		// A fresh Response per call — a Response body can only be read once.
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockImplementation(async () => jsonResponse(page));
		const client = createRivusApiClient(BASE, TOKEN, fetch);

		await client.listFaqs();
		expect(nthCall(fetch, 0).url).toBe(`${BASE}/v1/faqs?page=1&pageSize=20`);

		await client.listFaqs({ page: 2, pageSize: 100 });
		expect(nthCall(fetch, 1).url).toBe(`${BASE}/v1/faqs?page=2&pageSize=100`);
	});

	it('updates an FAQ with a JSON body and content-type', async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValue(jsonResponse({ ...faq, answer: 'Updated.' }));
		const client = createRivusApiClient(BASE, TOKEN, fetch);

		const updated = await client.updateFaq('faq_1' as FaqId, { answer: 'Updated.' });
		expect(updated.answer).toBe('Updated.');
		const { url, init } = nthCall(fetch, 0);
		expect(url).toBe(`${BASE}/v1/faqs/faq_1`);
		expect(init?.method).toBe('PATCH');
		expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
		expect(init?.body).toBe(JSON.stringify({ answer: 'Updated.' }));
	});

	it('creates an FAQ', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse(faq, 201));
		const client = createRivusApiClient(BASE, TOKEN, fetch);

		const created = await client.createFaq({
			question: 'Do you offer refunds?',
			answer: 'Yes, within 30 days.',
			category: '',
			status: 'published',
		});
		expect(created.id).toBe('faq_1');
		expect(nthCall(fetch, 0).init?.method).toBe('POST');
	});

	it('checks for a similar FAQ before creating', async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValue(jsonResponse({ match: faq, reason: 'same topic', merged: null }));
		const client = createRivusApiClient(BASE, TOKEN, fetch);

		const result = await client.findSimilarFaq({ question: 'Do you offer refunds?' });
		expect(result.match?.id).toBe('faq_1');
		const { url, init } = nthCall(fetch, 0);
		expect(url).toBe(`${BASE}/v1/faqs/similar`);
		expect(init?.method).toBe('POST');
		// The optional answer defaults to an empty string on the wire.
		expect(init?.body).toBe(JSON.stringify({ question: 'Do you offer refunds?', answer: '' }));
	});

	it('answers a question from the knowledge base', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
			jsonResponse({
				answered: true,
				answer: 'Our standard rate is $125 an hour, and $85 on weekends.',
				sources: [{ id: 'faq_1', question: 'How much does your service cost?' }],
			}),
		);
		const client = createRivusApiClient(BASE, TOKEN, fetch);

		const result = await client.answerFromKnowledge({ question: "what's our best price?" });
		expect(result.answered).toBe(true);
		expect(result.answer).toContain('$125');
		expect(result.sources[0]?.question).toBe('How much does your service cost?');
		const { url, init } = nthCall(fetch, 0);
		expect(url).toBe(`${BASE}/v1/faqs/answer`);
		expect(init?.method).toBe('POST');
		expect(init?.body).toBe(JSON.stringify({ question: "what's our best price?" }));
	});

	it('throws AgentApiError carrying the status and API message on non-2xx', async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValue(jsonResponse({ message: 'Insufficient permissions' }, 403));
		const client = createRivusApiClient(BASE, TOKEN, fetch);

		await expect(client.updateFaq('faq_1' as FaqId, { answer: 'x' })).rejects.toMatchObject({
			name: 'AgentApiError',
			status: 403,
			message: 'Insufficient permissions',
		});
	});

	it('falls back to a generic message when the error body has none', async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockImplementation(async () => new Response('', { status: 500 }));
		const client = createRivusApiClient(BASE, TOKEN, fetch);

		await expect(client.me()).rejects.toBeInstanceOf(AgentApiError);
		await expect(client.me()).rejects.toMatchObject({ status: 500 });
	});

	it('rejects a response that does not match the expected shape', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse({ nope: true }));
		const client = createRivusApiClient(BASE, TOKEN, fetch);
		await expect(client.me()).rejects.toThrow();
	});
});

function pageMeta(total: number) {
	return {
		page: 1,
		pageSize: 20,
		total,
		totalPages: 1,
		hasNextPage: false,
		hasPreviousPage: false,
	};
}

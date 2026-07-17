import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../src/services/resend-mailer';
import { BraveWebSearch, createWebSearchService, NoopWebSearch } from '../src/services/web-search';

/**
 * The Brave-backed web search the chat uses. Everything runs against an
 * injected fake `fetch` — the tests pin the wire shape (endpoint, auth header,
 * query encoding) and the defensive parsing of Brave's response.
 */

interface RecordedCall {
	url: string;
	init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal };
}

/** A scripted fetch that records what it was asked and answers one response. */
function fakeFetch(status: number, body: string): { fetchImpl: FetchLike; calls: RecordedCall[] } {
	const calls: RecordedCall[] = [];
	const fetchImpl: FetchLike = async (url, init) => {
		calls.push({ url, init });
		return { ok: status >= 200 && status < 300, status, text: async () => body };
	};
	return { fetchImpl, calls };
}

const RESULTS_BODY = JSON.stringify({
	web: {
		results: [
			{ title: 'Permit guide', url: 'https://permits.example', description: 'How to file.' },
			{ title: 'City fees', url: 'https://fees.example', description: 'Fee schedule.' },
		],
	},
});

describe('BraveWebSearch', () => {
	it('queries the endpoint with the subscription token and parses results', async () => {
		const { fetchImpl, calls } = fakeFetch(200, RESULTS_BODY);
		const search = new BraveWebSearch({ apiKey: 'brave-key', fetchImpl });

		const results = await search.search('permit requirements');

		expect(results).toEqual([
			{ title: 'Permit guide', url: 'https://permits.example', description: 'How to file.' },
			{ title: 'City fees', url: 'https://fees.example', description: 'Fee schedule.' },
		]);
		expect(calls).toHaveLength(1);
		const [call] = calls;
		expect(call?.url).toContain('https://api.search.brave.com/res/v1/web/search?q=');
		expect(call?.url).toContain('count=5');
		expect(call?.init.method).toBe('GET');
		expect(call?.init.headers['x-subscription-token']).toBe('brave-key');
		expect(call?.init.headers.accept).toBe('application/json');
		// A deadline always rides along so a stalled provider can't pin the request.
		expect(call?.init.signal).toBeInstanceOf(AbortSignal);
	});

	it('URL-encodes the query', async () => {
		const { fetchImpl, calls } = fakeFetch(200, RESULTS_BODY);
		const search = new BraveWebSearch({ apiKey: 'k', fetchImpl });

		await search.search('cheap "pumps" & heaters?');

		expect(calls[0]?.url).toContain(`q=${encodeURIComponent('cheap "pumps" & heaters?')}`);
	});

	it('answers an empty query locally without a provider call', async () => {
		const { fetchImpl, calls } = fakeFetch(200, RESULTS_BODY);
		const search = new BraveWebSearch({ apiKey: 'k', fetchImpl });

		await expect(search.search('   ')).resolves.toEqual([]);
		expect(calls).toHaveLength(0);
	});

	it('drops malformed entries and defaults a missing description', async () => {
		const body = JSON.stringify({
			web: {
				results: [
					// Non-object entries must be dropped, not property-accessed.
					null,
					'not an object',
					42,
					{ title: 'No url here' },
					{ url: 'https://untitled.example' },
					{ title: 'Fine', url: 'https://fine.example' },
					{ title: 42, url: 'https://bad-title.example' },
				],
			},
		});
		const { fetchImpl } = fakeFetch(200, body);
		const search = new BraveWebSearch({ apiKey: 'k', fetchImpl });

		await expect(search.search('anything')).resolves.toEqual([
			{ title: 'Fine', url: 'https://fine.example', description: '' },
		]);
	});

	it('caps the parsed results at the requested page size', async () => {
		const body = JSON.stringify({
			web: {
				results: Array.from({ length: 9 }, (_, i) => ({
					title: `Hit ${i}`,
					url: `https://hit.example/${i}`,
					description: '',
				})),
			},
		});
		const { fetchImpl } = fakeFetch(200, body);
		const search = new BraveWebSearch({ apiKey: 'k', fetchImpl });

		await expect(search.search('anything')).resolves.toHaveLength(5);
	});

	it('returns no results when the response has no web results at all', async () => {
		const { fetchImpl } = fakeFetch(200, JSON.stringify({ query: { original: 'x' } }));
		const search = new BraveWebSearch({ apiKey: 'k', fetchImpl });

		await expect(search.search('anything')).resolves.toEqual([]);
	});

	it('throws with the status and detail on a non-2xx response', async () => {
		const { fetchImpl } = fakeFetch(429, 'rate limited');
		const search = new BraveWebSearch({ apiKey: 'k', fetchImpl });

		await expect(search.search('anything')).rejects.toThrow(
			'Brave Search rejected the query (status 429): rate limited',
		);
	});

	it('throws on a non-JSON body', async () => {
		const { fetchImpl } = fakeFetch(200, '<html>upstream error</html>');
		const search = new BraveWebSearch({ apiKey: 'k', fetchImpl });

		await expect(search.search('anything')).rejects.toThrow(
			'Brave Search returned a non-JSON response',
		);
	});
});

describe('createWebSearchService', () => {
	it('is the disabled no-op without a key', async () => {
		const service = createWebSearchService({ BRAVE_SEARCH_API_KEY: undefined });

		expect(service).toBeInstanceOf(NoopWebSearch);
		expect(service.enabled).toBe(false);
		await expect(service.search('anything')).resolves.toEqual([]);
	});

	it('is the Brave client (with the injected fetch) when the key is set', async () => {
		const { fetchImpl, calls } = fakeFetch(200, RESULTS_BODY);
		const service = createWebSearchService({ BRAVE_SEARCH_API_KEY: 'brave-key' }, fetchImpl);

		expect(service.enabled).toBe(true);
		await service.search('anything');
		expect(calls).toHaveLength(1);
	});
});

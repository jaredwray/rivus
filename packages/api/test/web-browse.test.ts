import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../src/services/resend-mailer';
import {
	createWebBrowseService,
	NoopWebBrowse,
	parseHttpUrl,
	ZenrowsBrowser,
} from '../src/services/web-browse';

/**
 * The ZenRows-backed page fetcher the chat uses. Tests pin the wire shape (the
 * target rides in the `url` param alongside the render/proxy/markdown flags)
 * and the guardrails: only absolute http(s) targets, bounded content.
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

describe('ZenrowsBrowser', () => {
	it('fetches through the ZenRows endpoint with render + proxy + markdown flags', async () => {
		const { fetchImpl, calls } = fakeFetch(200, '# Pricing\n\nStarter: $10/mo\n');
		const browser = new ZenrowsBrowser({ apiKey: 'zr-key', fetchImpl });

		const page = await browser.browse('https://example.com/pricing');

		expect(page).toEqual({
			url: 'https://example.com/pricing',
			content: '# Pricing\n\nStarter: $10/mo',
		});
		expect(calls).toHaveLength(1);
		const requested = new URL(calls[0]?.url ?? '');
		expect(`${requested.origin}${requested.pathname}`).toBe('https://api.zenrows.com/v1/');
		expect(requested.searchParams.get('apikey')).toBe('zr-key');
		expect(requested.searchParams.get('url')).toBe('https://example.com/pricing');
		expect(requested.searchParams.get('js_render')).toBe('true');
		expect(requested.searchParams.get('premium_proxy')).toBe('true');
		expect(requested.searchParams.get('response_type')).toBe('markdown');
		expect(calls[0]?.init.method).toBe('GET');
		// A deadline always rides along so a stalled provider can't pin the request.
		expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
	});

	it.each([
		'ftp://example.com/file',
		'javascript:alert(1)',
		'not a url',
		'file:///etc/hosts',
	])('refuses the non-web target %s without calling out', async (target) => {
		const { fetchImpl, calls } = fakeFetch(200, 'never read');
		const browser = new ZenrowsBrowser({ apiKey: 'k', fetchImpl });

		await expect(browser.browse(target)).rejects.toThrow(
			'web browse only accepts absolute http(s) URLs',
		);
		expect(calls).toHaveLength(0);
	});

	it('throws with the status and detail on a non-2xx response', async () => {
		const { fetchImpl } = fakeFetch(422, 'could not solve challenge');
		const browser = new ZenrowsBrowser({ apiKey: 'k', fetchImpl });

		await expect(browser.browse('https://example.com')).rejects.toThrow(
			'ZenRows could not fetch the page (status 422): could not solve challenge',
		);
	});

	it('caps pathological page content at the bounded size', async () => {
		const { fetchImpl } = fakeFetch(200, 'a'.repeat(50_000));
		const browser = new ZenrowsBrowser({ apiKey: 'k', fetchImpl });

		const page = await browser.browse('https://example.com');

		expect(page.content).toHaveLength(12_000);
		expect(page.content.endsWith('…')).toBe(true);
	});
});

describe('parseHttpUrl', () => {
	it('accepts and normalizes absolute http(s) addresses', () => {
		expect(parseHttpUrl('https://example.com/pricing')).toBe('https://example.com/pricing');
		expect(parseHttpUrl('  http://example.com  ')).toBe('http://example.com/');
	});

	it('rejects other schemes and non-URLs', () => {
		expect(parseHttpUrl('ftp://example.com')).toBeNull();
		expect(parseHttpUrl('javascript:alert(1)')).toBeNull();
		expect(parseHttpUrl('example.com/no-scheme')).toBeNull();
		expect(parseHttpUrl('')).toBeNull();
	});
});

describe('createWebBrowseService', () => {
	it('is the disabled no-op without a key', async () => {
		const service = createWebBrowseService({ ZENROWS_API_KEY: undefined });

		expect(service).toBeInstanceOf(NoopWebBrowse);
		expect(service.enabled).toBe(false);
		await expect(service.browse('https://example.com')).resolves.toEqual({
			url: 'https://example.com',
			content: '',
		});
	});

	it('is the ZenRows client (with the injected fetch) when the key is set', async () => {
		const { fetchImpl, calls } = fakeFetch(200, 'content');
		const service = createWebBrowseService({ ZENROWS_API_KEY: 'zr-key' }, fetchImpl);

		expect(service.enabled).toBe(true);
		await service.browse('https://example.com');
		expect(calls).toHaveLength(1);
	});
});

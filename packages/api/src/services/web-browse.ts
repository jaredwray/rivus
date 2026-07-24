import type { Config } from '../config';
import type { FetchLike } from './resend-mailer';

/**
 * Web browsing for the Rivus chat, backed by ZenRows' Universal Scraper API.
 * ZenRows fetches the page from its own infrastructure — rotating residential
 * proxies plus a headless browser — so JS-rendered pages and sites that block
 * plain server-side requests still come back readable, and the target only
 * ever sees ZenRows' egress, never this API's. Content is requested as
 * markdown so the chat can quote it without an HTML stripper of our own.
 */

/** A fetched page, reduced to what the chat needs. */
export interface BrowsedPage {
	/** The normalized URL that was fetched. */
	url: string;
	/** The page's readable (markdown) content, capped to a bounded size. */
	content: string;
}

export interface WebBrowseService {
	/** False on the no-op service, so the chat explains browsing isn't enabled. */
	readonly enabled: boolean;
	/** Fetch `url` (absolute http/https only) and return its readable content. */
	browse(url: string): Promise<BrowsedPage>;
}

/** Browsing is disabled (no `ZENROWS_API_KEY`): never calls out. */
export class NoopWebBrowse implements WebBrowseService {
	readonly enabled = false;
	async browse(url: string): Promise<BrowsedPage> {
		return { url, content: '' };
	}
}

const ZENROWS_ENDPOINT = 'https://api.zenrows.com/v1/';

// Bound what one browse can bring into memory (and downstream prompts/replies).
// A rendered article is well under this; only pathological pages are clipped.
const MAX_CONTENT_CHARS = 12_000;

// Deadline on the provider call. Generous because `js_render` + residential
// proxying legitimately takes tens of seconds on heavy pages, but a stalled
// upstream must still fail into the chat's "couldn't read that page" reply
// instead of pinning the request until the transport gives up on its own.
const BROWSE_TIMEOUT_MS = 60_000;

export interface ZenrowsBrowserOptions {
	apiKey: string;
	/** Injectable fetch; defaults to the global. */
	fetchImpl?: FetchLike;
	/** Override the ZenRows endpoint (tests). */
	endpoint?: string;
}

/**
 * Fetches pages through ZenRows (GET `https://api.zenrows.com/v1/` with the
 * target in the `url` param). `js_render` + `premium_proxy` is the documented
 * combination for JS-heavy and bot-walled pages; `response_type=markdown` makes
 * ZenRows return readable markdown instead of raw HTML.
 */
export class ZenrowsBrowser implements WebBrowseService {
	readonly enabled = true;
	private readonly apiKey: string;
	private readonly fetchImpl: FetchLike;
	private readonly endpoint: string;

	constructor(options: ZenrowsBrowserOptions) {
		this.apiKey = options.apiKey;
		this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
		this.endpoint = options.endpoint ?? ZENROWS_ENDPOINT;
	}

	async browse(url: string): Promise<BrowsedPage> {
		const target = parseHttpUrl(url);
		if (target === null) {
			throw new Error(`web browse only accepts absolute http(s) URLs, got "${url}"`);
		}
		const params = new URLSearchParams({
			apikey: this.apiKey,
			url: target,
			js_render: 'true',
			premium_proxy: 'true',
			response_type: 'markdown',
		});
		const response = await this.fetchImpl(`${this.endpoint}?${params.toString()}`, {
			method: 'GET',
			headers: {},
			signal: AbortSignal.timeout(BROWSE_TIMEOUT_MS),
		});
		if (!response.ok) {
			const detail = await response.text().catch(() => '');
			throw new Error(
				`ZenRows could not fetch the page (status ${response.status})${detail ? `: ${detail}` : ''}`,
			);
		}
		const body = (await response.text()).trim();
		const content =
			body.length <= MAX_CONTENT_CHARS
				? body
				: `${body.slice(0, MAX_CONTENT_CHARS - 1).trimEnd()}…`;
		return { url: target, content };
	}
}

/**
 * `value` as a validated, normalized absolute http(s) URL, or null. The chat's
 * routers and the browser itself all funnel through this, so a non-web scheme
 * (`javascript:`, `file:`, `ftp:`) can never reach the fetch.
 */
export function parseHttpUrl(value: string): string | null {
	let parsed: URL;
	try {
		parsed = new URL(value.trim());
	} catch {
		return null;
	}
	return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
}

/**
 * Pick a browse service for the config: ZenRows when its API key is present,
 * otherwise the no-op — the API always boots, and the chat says the tool is off.
 */
export function createWebBrowseService(
	config: Pick<Config, 'ZENROWS_API_KEY'>,
	fetchImpl?: FetchLike,
): WebBrowseService {
	if (!config.ZENROWS_API_KEY) {
		return new NoopWebBrowse();
	}
	return new ZenrowsBrowser({ apiKey: config.ZENROWS_API_KEY, fetchImpl });
}

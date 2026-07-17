import type { Config } from '../config';
import type { FetchLike } from './resend-mailer';

/**
 * Web search for the Rivus chat, backed by the Brave Search API. This is what
 * lets the assistant answer from the live web — current prices, regulations,
 * competitors — instead of only the account's own knowledge base. The provider
 * is called directly over HTTP (no SDK), matching the Resend/Twilio transports:
 * a small dependency surface and a trivially injectable fake `fetch` in tests.
 */

/** One web hit, reduced to what a chat reply shows. */
export interface WebSearchResult {
	title: string;
	url: string;
	description: string;
}

export interface WebSearchService {
	/** False on the no-op service, so the chat explains search isn't enabled. */
	readonly enabled: boolean;
	/** The top web results for `query` (already bounded to a chat-sized page). */
	search(query: string): Promise<WebSearchResult[]>;
}

/** Search is disabled (no `BRAVE_SEARCH_API_KEY`): never calls out. */
export class NoopWebSearch implements WebSearchService {
	readonly enabled = false;
	async search(): Promise<WebSearchResult[]> {
		return [];
	}
}

const BRAVE_SEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

/** How many results one search asks for — a chat reply only ever shows a handful. */
const RESULT_COUNT = 5;

export interface BraveWebSearchOptions {
	apiKey: string;
	/** Injectable fetch; defaults to the global. */
	fetchImpl?: FetchLike;
	/** Override the Brave endpoint (tests). */
	endpoint?: string;
}

/** The slice of Brave's response the chat reads; everything else is ignored. */
interface BraveSearchBody {
	web?: { results?: Array<{ title?: unknown; url?: unknown; description?: unknown }> };
}

/**
 * Searches the web through Brave's Web Search API (GET with the query in `q`,
 * authenticated by the `X-Subscription-Token` header). Results come back under
 * `web.results` and are parsed defensively: a malformed entry is dropped, never
 * thrown on, so one odd hit can't break the whole reply.
 */
export class BraveWebSearch implements WebSearchService {
	readonly enabled = true;
	private readonly apiKey: string;
	private readonly fetchImpl: FetchLike;
	private readonly endpoint: string;

	constructor(options: BraveWebSearchOptions) {
		this.apiKey = options.apiKey;
		this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
		this.endpoint = options.endpoint ?? BRAVE_SEARCH_ENDPOINT;
	}

	async search(query: string): Promise<WebSearchResult[]> {
		const q = query.trim();
		// Nothing to search for — answer locally instead of burning a paid call
		// Brave would reject anyway.
		if (q === '') {
			return [];
		}
		const response = await this.fetchImpl(
			`${this.endpoint}?q=${encodeURIComponent(q)}&count=${RESULT_COUNT}`,
			{
				method: 'GET',
				headers: {
					accept: 'application/json',
					'x-subscription-token': this.apiKey,
				},
			},
		);
		if (!response.ok) {
			const detail = await response.text().catch(() => '');
			throw new Error(
				`Brave Search rejected the query (status ${response.status})${detail ? `: ${detail}` : ''}`,
			);
		}
		return parseBraveResults(await response.text());
	}
}

/** Pull the chat-worthy results out of Brave's JSON, dropping malformed entries. */
function parseBraveResults(body: string): WebSearchResult[] {
	let parsed: BraveSearchBody;
	try {
		parsed = JSON.parse(body) as BraveSearchBody;
	} catch {
		throw new Error('Brave Search returned a non-JSON response');
	}
	const entries = parsed.web?.results;
	if (!Array.isArray(entries)) {
		return [];
	}
	const results: WebSearchResult[] = [];
	for (const entry of entries) {
		if (results.length >= RESULT_COUNT) {
			break;
		}
		if (typeof entry.title === 'string' && typeof entry.url === 'string') {
			results.push({
				title: entry.title,
				url: entry.url,
				description: typeof entry.description === 'string' ? entry.description : '',
			});
		}
	}
	return results;
}

/**
 * Pick a search service for the config: Brave when its API key is present,
 * otherwise the no-op — the API always boots, and the chat says the tool is off.
 */
export function createWebSearchService(
	config: Pick<Config, 'BRAVE_SEARCH_API_KEY'>,
	fetchImpl?: FetchLike,
): WebSearchService {
	if (!config.BRAVE_SEARCH_API_KEY) {
		return new NoopWebSearch();
	}
	return new BraveWebSearch({ apiKey: config.BRAVE_SEARCH_API_KEY, fetchImpl });
}

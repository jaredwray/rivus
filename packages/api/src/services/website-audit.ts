import type { Account, AccountId } from '@rivus/core';
import type { Config } from '../config';
import { createWebBrowseService, parseHttpUrl, type WebBrowseService } from './web-browse';
import { createWebSearchService, type WebSearchService } from './web-search';

/**
 * The website audit — the one purpose the chat's web tools serve. Rivus fetches
 * the ACCOUNT'S OWN website (ZenRows, so JS-rendered and bot-walled sites still
 * load), checks it for the essentials a customer looks for — business name,
 * phone, address, hours, a way to get in touch — against the Rivus profile and
 * knowledge base, and (when Brave is configured) searches the business name to
 * see whether the site surfaces at all.
 *
 * Deliberately narrow: the browse target always comes from the account record,
 * never from the message, so the paid proxy can't be steered at arbitrary URLs;
 * and a per-account cooldown keeps repeated asks from burning provider credits.
 */

/** One pass/fail line of the audit report, ready to render as `✓/✗ label`. */
export interface AuditCheck {
	id: string;
	label: string;
	passed: boolean;
}

export interface WebsiteAuditReport {
	/** The normalized URL that was audited. */
	url: string;
	checks: AuditCheck[];
}

export type WebsiteAuditOutcome =
	/** No ZenRows key — the audit can't fetch the site at all. */
	| { kind: 'disabled' }
	/** The account has no (usable) website on its profile. */
	| { kind: 'no_website' }
	/** An audit ran recently; when the next one may run. */
	| { kind: 'cooldown'; retryInMinutes: number }
	/** The site didn't load (down, blocking, or empty). */
	| { kind: 'unreachable'; url: string }
	| { kind: 'report'; report: WebsiteAuditReport };

export interface WebsiteAuditInput {
	account: Account;
	/** How many FAQs the knowledge base holds (for the readiness check). */
	faqCount: number;
}

export interface WebsiteAuditService {
	audit(input: WebsiteAuditInput): Promise<WebsiteAuditOutcome>;
}

// One audit spends a ZenRows render + a Brave query, so repeated asks are held
// off. In-memory is sound here: the API deploys as a single long-lived
// container (see worker/index.ts), and losing the map on restart only allows
// one extra audit.
const AUDIT_COOLDOWN_MS = 10 * 60_000;

// Bound the cooldown map so it can't grow without limit on a long-lived
// container: once it's large, drop entries whose cooldown has already expired
// (they're inert). Audits are cooldown-gated, so this sweep runs rarely and
// keeps the live size near the number of accounts audited within one window.
const MAX_COOLDOWN_ENTRIES = 10_000;

/**
 * The account's website as a fetchable absolute URL. Profiles commonly store a
 * bare host ("example.com") — complete it with https rather than refusing the
 * audit; anything that still isn't a public http(s) host is treated as "no
 * website".
 *
 * The host must be a real public domain: no raw IPs, loopback, or dotless hosts.
 * `account.website` is already validated at write time (core's `websiteSchema`
 * requires a lettered-TLD domain) and the fetch is performed by ZenRows, not
 * this API — so this is defense-in-depth, keeping an internal-metadata address
 * from ever being produced here even if a future path fetched it directly.
 */
export function websiteUrl(website: string): string | null {
	const trimmed = website.trim();
	if (trimmed === '') {
		return null;
	}
	const direct = parseHttpUrl(trimmed);
	const normalized =
		direct ??
		// Only a dotted, space-free host is worth completing into an address.
		(/^[^\s/:]+\.[^\s]+$/.test(trimmed) ? parseHttpUrl(`https://${trimmed}`) : null);
	if (normalized === null) {
		return null;
	}
	return isPublicHost(new URL(normalized).hostname) ? normalized : null;
}

/**
 * Whether `host` is a public domain name rather than a raw IP, loopback, or
 * dotless internal host. A real business website is a dotted name; an IP literal
 * (v4 starts with a digit; v6 contains `:`) or `localhost` is never one.
 */
function isPublicHost(host: string): boolean {
	const lower = host.toLowerCase();
	if (lower === 'localhost' || lower.endsWith('.localhost')) {
		return false;
	}
	if (lower.includes(':') || /^\d/.test(lower)) {
		return false;
	}
	return lower.includes('.');
}

/** Digit-only form of a phone number, for provider-agnostic comparison. */
function digitsOf(value: string): string {
	return value.replace(/\D/g, '');
}

/**
 * Whether the account's phone number appears on the page. The whole page is
 * reduced to one digit stream and searched for the profile number's significant
 * suffix (its last 10 digits, or all of them when shorter), so formatting,
 * punctuation, and a leading country code don't matter. We deliberately don't
 * try to detect a *different* number on the site: telling a real phone apart
 * from an order number, price, or date in free markdown isn't reliable, and a
 * false "your number is stale" is worse than a missed one.
 */
function phoneOnPage(profilePhone: string, content: string): boolean {
	const profileDigits = digitsOf(profilePhone);
	if (profileDigits.length < 7) {
		return false;
	}
	const suffix = profileDigits.slice(-10);
	return digitsOf(content).includes(suffix);
}

/** Escape a literal string for safe embedding in a RegExp. */
function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether `needle` appears in `haystack` as a whole token, not inside a larger
 * word — so a name like "Flow" isn't matched by "workflow". Boundaries are
 * non-alphanumeric (Unicode-aware, so accented names and multi-word names work).
 * It can't tell a name apart from an identical common word ("Bloom" vs "in full
 * bloom") — no string match can — but it removes the substring-in-word noise.
 */
function containsWord(haystack: string, needle: string): boolean {
	const trimmed = needle.trim().toLowerCase();
	if (trimmed === '') {
		return false;
	}
	return new RegExp(
		`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(trimmed)}(?:[^\\p{L}\\p{N}]|$)`,
		'iu',
	).test(haystack.toLowerCase());
}

/**
 * Whether the profile's street address appears on the page, matched loosely: the
 * street NUMBER plus the first significant word that follows it must both appear
 * as tokens. That absorbs abbreviation differences ("St"/"Street", "SE"/
 * "Southeast") and ignores a name-first address line, without exact-substring
 * brittleness. Returns null when no street number is on file (nothing to match).
 */
function addressOnPage(address: string, content: string): boolean | null {
	const tokens = address.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
	const numberIndex = tokens.findIndex((token) => /^\d{1,6}$/.test(token));
	if (numberIndex < 0) {
		return null;
	}
	const streetNumber = tokens[numberIndex] as string;
	const streetWord = tokens
		.slice(numberIndex + 1)
		.find((token) => token.length > 3 && !/^\d+$/.test(token));
	if (streetWord === undefined) {
		return null;
	}
	return containsWord(content, streetNumber) && containsWord(content, streetWord);
}

// A real-looking email address. The negative lookahead drops asset filenames
// like "logo@2x.png" (the "TLD" would be an image/asset extension), which the
// contact check would otherwise mistake for a way to get in touch.
const EMAIL_IN_TEXT =
	/[\w.+-]+@[\w-]+\.(?!png|jpe?g|gif|svg|webp|avif|ico|css|js|json|woff2?|ttf|eot|mp[34]|pdf)[a-z]{2,24}\b/i;
// Contact-affordance wording, distinct from an incidental word — a real email,
// or a phrase that signals a contact route.
const CONTACT_IN_TEXT = /\b(?:contact us|contact form|get in touch|email us|reach us|call us)\b/i;
// Business-hours wording in CONTEXT — never the bare word "hours" (which also
// shows up in "24 hours", "after hours", "saved hundreds of hours").
const HOURS_IN_TEXT =
	/\b(?:business|opening|store|office|trading|working|shop)\s+hours\b|\bhours\s+of\s+operation\b|\bopening times\b|\bhours?\s*:\s*\S|\bopen(?:ing)?\s+(?:mon|tue|wed|thu|fri|sat|sun|daily|weekdays?|weekends?)/i;

/**
 * The content-based checks, pure over the fetched markdown so they're
 * exhaustively unit-testable. Each check reads as one report line.
 */
export function contentChecks(account: Account, content: string, faqCount: number): AuditCheck[] {
	const checks: AuditCheck[] = [];

	const name = account.name.trim();
	checks.push(
		name !== '' && containsWord(content, name)
			? { id: 'name', label: `Your business name “${account.name}” is on the page`, passed: true }
			: {
					id: 'name',
					label: `Your business name “${account.name}” isn’t on the page — customers should see who they’re hiring`,
					passed: false,
				},
	);

	// Only judge the phone when the profile has a usable number to look for.
	if (digitsOf(account.phone).length >= 7) {
		checks.push(
			phoneOnPage(account.phone, content)
				? { id: 'phone', label: 'Your phone number is on the site', passed: true }
				: {
						id: 'phone',
						label: 'Your phone number isn’t on the site — add it so customers can call',
						passed: false,
					},
		);
	} else {
		checks.push({
			id: 'phone',
			label:
				'Add a phone number to your Rivus profile so I can check it’s on your site and customers can call',
			passed: false,
		});
	}

	// Only judge the address when the profile has a street number to match on.
	const addressResult = addressOnPage(account.address, content);
	if (addressResult !== null) {
		checks.push(
			addressResult
				? { id: 'address', label: 'Your address is on the site', passed: true }
				: {
						id: 'address',
						label: 'Your address isn’t on the site — local customers look for it',
						passed: false,
					},
		);
	}

	checks.push(
		EMAIL_IN_TEXT.test(content) || CONTACT_IN_TEXT.test(content)
			? {
					id: 'contact',
					label: 'There’s a way to get in touch (contact info present)',
					passed: true,
				}
			: {
					id: 'contact',
					label: 'No contact email or contact section found — make it easy to reach you',
					passed: false,
				},
	);

	checks.push(
		HOURS_IN_TEXT.test(content)
			? { id: 'hours', label: 'Business hours are mentioned', passed: true }
			: {
					id: 'hours',
					label: 'No business hours found — customers check these before calling',
					passed: false,
				},
	);

	checks.push(
		faqCount > 0
			? {
					id: 'knowledge',
					label: `Your Rivus knowledge base has ${faqCount} FAQ${faqCount === 1 ? '' : 's'} ready for customer questions`,
					passed: true,
				}
			: {
					id: 'knowledge',
					label:
						'Your Rivus knowledge base is empty — add FAQs so I can answer customers about what’s on your site',
					passed: false,
				},
	);

	return checks;
}

/** The site's host with any `www.` prefix dropped, for presence comparison. */
function bareHost(url: string): string | null {
	try {
		return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
	} catch {
		return null;
	}
}

/**
 * Whether two hosts belong to the same site, so a bare domain and any of its
 * subdomains match (`example.com` ⇔ `shop.example.com`) — a search listing on a
 * subdomain still counts as the site showing up.
 */
function sameSite(a: string, b: string): boolean {
	return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

export interface WebsiteAuditServiceOptions {
	/** Injected for tests; default to the config-gated real services. */
	webSearch?: WebSearchService;
	webBrowse?: WebBrowseService;
	/** Injected clock for cooldown tests; defaults to `Date.now`. */
	now?: () => number;
}

/**
 * Build the audit service. The web services live INSIDE it — nothing else in
 * the API can reach them, which is what keeps the tools bound to this one
 * purpose. Disabled ZenRows ⇒ every audit answers `disabled`; disabled Brave
 * only skips the presence check.
 */
export function createWebsiteAuditService(
	config: Pick<Config, 'BRAVE_SEARCH_API_KEY' | 'ZENROWS_API_KEY'>,
	options: WebsiteAuditServiceOptions = {},
): WebsiteAuditService {
	const webSearch = options.webSearch ?? createWebSearchService(config);
	const webBrowse = options.webBrowse ?? createWebBrowseService(config);
	const now = options.now ?? Date.now;
	const lastRunAt = new Map<AccountId, number>();

	return {
		async audit({ account, faqCount }) {
			if (!webBrowse.enabled) {
				return { kind: 'disabled' };
			}
			const url = websiteUrl(account.website);
			if (url === null) {
				return { kind: 'no_website' };
			}

			const startedAt = now();
			const lastRun = lastRunAt.get(account.id);
			if (lastRun !== undefined && startedAt - lastRun < AUDIT_COOLDOWN_MS) {
				const retryInMinutes = Math.ceil((AUDIT_COOLDOWN_MS - (startedAt - lastRun)) / 60_000);
				return { kind: 'cooldown', retryInMinutes };
			}
			// Stamped before fetching: an unreachable site spent a provider call too.
			if (lastRunAt.size >= MAX_COOLDOWN_ENTRIES) {
				for (const [id, at] of lastRunAt) {
					if (startedAt - at >= AUDIT_COOLDOWN_MS) {
						lastRunAt.delete(id);
					}
				}
			}
			lastRunAt.set(account.id, startedAt);

			let content: string;
			try {
				content = (await webBrowse.browse(url)).content;
			} catch {
				return { kind: 'unreachable', url };
			}
			if (content.trim() === '') {
				return { kind: 'unreachable', url };
			}

			const checks = contentChecks(account, content, faqCount);

			// Presence: does the site surface when a customer searches the business
			// name? Skipped (not failed) when Brave is off or the search errors —
			// the content checks above are still a complete, honest audit.
			if (webSearch.enabled && account.name.trim() !== '') {
				const host = bareHost(url);
				try {
					const results = await webSearch.search(account.name);
					if (host !== null) {
						const found = results.some((result) => {
							const resultHost = bareHost(result.url);
							return resultHost !== null && sameSite(resultHost, host);
						});
						checks.push(
							found
								? {
										id: 'presence',
										label: `Your site shows up in a web search for “${account.name}”`,
										passed: true,
									}
								: {
										id: 'presence',
										label: `Your site didn’t show up in the top web results for “${account.name}” — worth investing in listings and SEO`,
										passed: false,
									},
						);
					}
				} catch {
					// A presence check that couldn't run is omitted, never guessed at.
				}
			}

			return { kind: 'report', report: { url, checks } };
		},
	};
}

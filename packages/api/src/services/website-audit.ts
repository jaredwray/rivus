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

/**
 * The account's website as a fetchable absolute URL. Profiles commonly store a
 * bare host ("example.com") — complete it with https rather than refusing the
 * audit; anything that still isn't http(s) is treated as "no website".
 */
export function websiteUrl(website: string): string | null {
	const trimmed = website.trim();
	if (trimmed === '') {
		return null;
	}
	const direct = parseHttpUrl(trimmed);
	if (direct !== null) {
		return direct;
	}
	// Only a dotted, space-free host is worth completing into an address.
	if (!/^[^\s/:]+\.[^\s]+$/.test(trimmed)) {
		return null;
	}
	return parseHttpUrl(`https://${trimmed}`);
}

/** Digit-only form of a phone number, for provider-agnostic comparison. */
function digitsOf(value: string): string {
	return value.replace(/\D/g, '');
}

/** Phone-number-looking runs in the page, as digit strings (7–15 digits). */
function phonesIn(content: string): string[] {
	const matches = content.match(/\+?\d[\d\s().-]{5,18}\d/g) ?? [];
	return matches.map(digitsOf).filter((digits) => digits.length >= 7 && digits.length <= 15);
}

/** Whether two phone numbers plausibly refer to the same line (compare last 10 digits). */
function samePhone(a: string, b: string): boolean {
	const tailA = a.slice(-10);
	const tailB = b.slice(-10);
	return tailA !== '' && tailA === tailB;
}

const EMAIL_IN_TEXT = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const HOURS_IN_TEXT =
	/\b(?:hours|opening times|open (?:mon|tue|wed|thu|fri|sat|sun|daily|weekdays|weekends))\b/i;

/**
 * The content-based checks, pure over the fetched markdown so they're
 * exhaustively unit-testable. Each check reads as one report line.
 */
export function contentChecks(account: Account, content: string, faqCount: number): AuditCheck[] {
	const checks: AuditCheck[] = [];
	const lower = content.toLowerCase();

	checks.push(
		account.name.trim() !== '' && lower.includes(account.name.trim().toLowerCase())
			? { id: 'name', label: `Your business name “${account.name}” is on the page`, passed: true }
			: {
					id: 'name',
					label: `Your business name “${account.name}” isn’t on the page — customers should see who they’re hiring`,
					passed: false,
				},
	);

	const profilePhone = digitsOf(account.phone);
	const sitePhones = phonesIn(content);
	if (profilePhone.length >= 7) {
		if (sitePhones.some((phone) => samePhone(phone, profilePhone))) {
			checks.push({
				id: 'phone',
				label: 'The phone number on the site matches your Rivus profile',
				passed: true,
			});
		} else if (sitePhones.length > 0) {
			checks.push({
				id: 'phone',
				label:
					'The phone number on the site doesn’t match the one on your Rivus profile — one of them is stale',
				passed: false,
			});
		} else {
			checks.push({
				id: 'phone',
				label: 'Your phone number isn’t on the site — add it so customers can call',
				passed: false,
			});
		}
	} else {
		checks.push(
			sitePhones.length > 0
				? {
						id: 'phone',
						label:
							'A phone number is on the site — add it to your Rivus profile too so they stay in sync',
						passed: true,
					}
				: {
						id: 'phone',
						label:
							'No phone number found on the site (or your Rivus profile) — customers expect one',
						passed: false,
					},
		);
	}

	// Only judge the address when the profile has one to compare against; the
	// street line (before the first comma) is the part a site plausibly prints.
	const streetLine = account.address.split(',')[0]?.trim() ?? '';
	if (streetLine.length > 3) {
		checks.push(
			lower.includes(streetLine.toLowerCase())
				? { id: 'address', label: 'Your address is on the site', passed: true }
				: {
						id: 'address',
						label: 'Your address isn’t on the site — local customers look for it',
						passed: false,
					},
		);
	}

	checks.push(
		EMAIL_IN_TEXT.test(content) || /\bcontact\b/i.test(content)
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
						const found = results.some((result) => bareHost(result.url) === host);
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

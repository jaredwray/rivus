import { faker } from '@faker-js/faker';
import type { Account, AccountId } from '@rivus/core';
import { describe, expect, it } from 'vitest';
import type { WebBrowseService } from '../src/services/web-browse';
import type { WebSearchResult, WebSearchService } from '../src/services/web-search';
import {
	type AuditCheck,
	contentChecks,
	createWebsiteAuditService,
	websiteUrl,
} from '../src/services/website-audit';

/**
 * The website-audit engine — the one purpose the web tools serve. Everything
 * runs against fake search/browse services, pinning the outcome ladder
 * (disabled → no_website → cooldown → unreachable → report), the content
 * checks, the presence check, and the per-account cooldown.
 */

function account(over: Partial<Account> = {}): Account {
	return {
		id: faker.string.uuid() as AccountId,
		name: 'Cascade Plumbing',
		slug: 'cascade-plumbing',
		phone: '(503) 555-0142',
		address: '410 SE Morrison St, Portland, OR',
		website: 'https://cascadeplumbing.example',
		timezone: 'America/Los_Angeles',
		...over,
	} as Account;
}

/** A browse service scripted with content (or a rejection), recording targets. */
function browsing(content: string | Error): WebBrowseService & { urls: string[] } {
	const urls: string[] = [];
	return {
		enabled: true,
		urls,
		async browse(url) {
			urls.push(url);
			if (content instanceof Error) {
				throw content;
			}
			return { url, content };
		},
	};
}

const DISABLED_BROWSE: WebBrowseService = {
	enabled: false,
	async browse(url) {
		return { url, content: '' };
	},
};

/** A search service scripted with results, recording queries. */
function searching(results: WebSearchResult[]): WebSearchService & { queries: string[] } {
	const queries: string[] = [];
	return {
		enabled: true,
		queries,
		async search(query) {
			queries.push(query);
			return results;
		},
	};
}

const DISABLED_SEARCH: WebSearchService = {
	enabled: false,
	async search() {
		return [];
	},
};

/** The whole-site fixture every content check passes on. */
const GOOD_SITE = [
	'# Cascade Plumbing',
	'Call us at (503) 555-0142 — or email hello@cascadeplumbing.example.',
	'Visit us at 410 SE Morrison St.',
	'Hours: Mon–Fri 8–5.',
].join('\n');

function checkById(checks: AuditCheck[], id: string): AuditCheck | undefined {
	return checks.find((check) => check.id === id);
}

describe('websiteUrl', () => {
	it('accepts absolute http(s) URLs and completes bare hosts', () => {
		expect(websiteUrl('https://example.com/x')).toBe('https://example.com/x');
		expect(websiteUrl('example.com')).toBe('https://example.com/');
	});

	it('rejects empty, non-web, and garbage values', () => {
		expect(websiteUrl('')).toBeNull();
		expect(websiteUrl('   ')).toBeNull();
		expect(websiteUrl('ftp://example.com')).toBeNull();
		expect(websiteUrl('not a website')).toBeNull();
	});
});

describe('contentChecks', () => {
	it('passes everything on a complete site with 3 FAQs', () => {
		const checks = contentChecks(account(), GOOD_SITE, 3);
		for (const id of ['name', 'phone', 'address', 'contact', 'hours', 'knowledge']) {
			expect(checkById(checks, id)?.passed, id).toBe(true);
		}
		expect(checkById(checks, 'knowledge')?.label).toContain('3 FAQs');
	});

	it('matches the business name case-insensitively', () => {
		const checks = contentChecks(account(), '# CASCADE PLUMBING\ncontact us', 0);
		expect(checkById(checks, 'name')?.passed).toBe(true);
	});

	it('fails the name check when the site never says who it is', () => {
		const checks = contentChecks(account(), 'We fix pipes. Call (503) 555-0142.', 0);
		expect(checkById(checks, 'name')?.passed).toBe(false);
	});

	it('matches the profile phone across formatting differences', () => {
		const checks = contentChecks(account({ phone: '+1 503 555 0142' }), GOOD_SITE, 0);
		expect(checkById(checks, 'phone')?.passed).toBe(true);
	});

	it('flags a site phone that differs from the profile as stale', () => {
		const checks = contentChecks(
			account(),
			'Cascade Plumbing — call (503) 555-9999 today!\ncontact',
			0,
		);
		const phone = checkById(checks, 'phone');
		expect(phone?.passed).toBe(false);
		expect(phone?.label).toMatch(/doesn’t match/);
	});

	it('fails when neither the site nor the profile has a phone', () => {
		const checks = contentChecks(account({ phone: '' }), 'Cascade Plumbing. contact', 0);
		expect(checkById(checks, 'phone')?.passed).toBe(false);
	});

	it('passes (with a sync nudge) when the site has a phone the profile lacks', () => {
		const checks = contentChecks(account({ phone: '' }), GOOD_SITE, 0);
		const phone = checkById(checks, 'phone');
		expect(phone?.passed).toBe(true);
		expect(phone?.label).toMatch(/add it to your Rivus profile/);
	});

	it('only judges the address when the profile has one', () => {
		expect(checkById(contentChecks(account({ address: '' }), GOOD_SITE, 0), 'address')).toBe(
			undefined,
		);
		const failing = contentChecks(
			account({ address: '99 Elsewhere Ave, Salem, OR' }),
			GOOD_SITE,
			0,
		);
		expect(checkById(failing, 'address')?.passed).toBe(false);
	});

	it('fails hours and contact when a site offers neither', () => {
		const checks = contentChecks(account(), 'Cascade Plumbing\n(503) 555-0142', 0);
		expect(checkById(checks, 'hours')?.passed).toBe(false);
		expect(checkById(checks, 'contact')?.passed).toBe(false);
	});

	it('flags an empty knowledge base', () => {
		const checks = contentChecks(account(), GOOD_SITE, 0);
		const knowledge = checkById(checks, 'knowledge');
		expect(knowledge?.passed).toBe(false);
		expect(knowledge?.label).toMatch(/knowledge base is empty/);
	});
});

describe('createWebsiteAuditService', () => {
	const CONFIG = {};

	it('answers disabled when browsing has no key, before touching anything', async () => {
		const service = createWebsiteAuditService(CONFIG, {
			webBrowse: DISABLED_BROWSE,
			webSearch: DISABLED_SEARCH,
		});
		await expect(service.audit({ account: account(), faqCount: 0 })).resolves.toEqual({
			kind: 'disabled',
		});
	});

	it('answers no_website when the profile has no usable site', async () => {
		const browse = browsing(GOOD_SITE);
		const service = createWebsiteAuditService(CONFIG, {
			webBrowse: browse,
			webSearch: DISABLED_SEARCH,
		});
		await expect(
			service.audit({ account: account({ website: '' }), faqCount: 0 }),
		).resolves.toEqual({ kind: 'no_website' });
		await expect(
			service.audit({ account: account({ website: 'not a website' }), faqCount: 0 }),
		).resolves.toEqual({ kind: 'no_website' });
		expect(browse.urls).toHaveLength(0);
	});

	it('completes a bare-host profile website and audits it over https', async () => {
		const browse = browsing(GOOD_SITE);
		const service = createWebsiteAuditService(CONFIG, {
			webBrowse: browse,
			webSearch: DISABLED_SEARCH,
		});
		const outcome = await service.audit({
			account: account({ website: 'cascadeplumbing.example' }),
			faqCount: 1,
		});
		expect(browse.urls).toEqual(['https://cascadeplumbing.example/']);
		expect(outcome.kind).toBe('report');
	});

	it('reports unreachable when the fetch fails or the page is empty', async () => {
		const failing = createWebsiteAuditService(CONFIG, {
			webBrowse: browsing(new Error('boom')),
			webSearch: DISABLED_SEARCH,
		});
		await expect(failing.audit({ account: account(), faqCount: 0 })).resolves.toEqual({
			kind: 'unreachable',
			url: 'https://cascadeplumbing.example/',
		});
		const empty = createWebsiteAuditService(CONFIG, {
			webBrowse: browsing('   '),
			webSearch: DISABLED_SEARCH,
		});
		await expect(empty.audit({ account: account(), faqCount: 0 })).resolves.toEqual({
			kind: 'unreachable',
			url: 'https://cascadeplumbing.example/',
		});
	});

	it('passes presence when a search for the name surfaces the site (www ignored)', async () => {
		const search = searching([
			{ title: 'Somewhere else', url: 'https://directory.example/x', description: '' },
			{ title: 'Cascade', url: 'https://www.cascadeplumbing.example/home', description: '' },
		]);
		const service = createWebsiteAuditService(CONFIG, {
			webBrowse: browsing(GOOD_SITE),
			webSearch: search,
		});
		const outcome = await service.audit({ account: account(), faqCount: 1 });
		expect(search.queries).toEqual(['Cascade Plumbing']);
		if (outcome.kind !== 'report') {
			throw new Error(`expected a report, got ${outcome.kind}`);
		}
		expect(checkById(outcome.report.checks, 'presence')?.passed).toBe(true);
	});

	it('fails presence when the site never surfaces', async () => {
		const service = createWebsiteAuditService(CONFIG, {
			webBrowse: browsing(GOOD_SITE),
			webSearch: searching([
				{ title: 'Competitor', url: 'https://other.example', description: '' },
			]),
		});
		const outcome = await service.audit({ account: account(), faqCount: 1 });
		if (outcome.kind !== 'report') {
			throw new Error(`expected a report, got ${outcome.kind}`);
		}
		expect(checkById(outcome.report.checks, 'presence')?.passed).toBe(false);
	});

	it('omits the presence check when search is disabled or errors', async () => {
		const noSearch = createWebsiteAuditService(CONFIG, {
			webBrowse: browsing(GOOD_SITE),
			webSearch: DISABLED_SEARCH,
		});
		const withoutSearch = await noSearch.audit({ account: account(), faqCount: 1 });
		if (withoutSearch.kind !== 'report') {
			throw new Error(`expected a report, got ${withoutSearch.kind}`);
		}
		expect(checkById(withoutSearch.report.checks, 'presence')).toBe(undefined);

		const erroring = createWebsiteAuditService(CONFIG, {
			webBrowse: browsing(GOOD_SITE),
			webSearch: {
				enabled: true,
				async search() {
					throw new Error('search down');
				},
			},
		});
		const withError = await erroring.audit({ account: account(), faqCount: 1 });
		if (withError.kind !== 'report') {
			throw new Error(`expected a report, got ${withError.kind}`);
		}
		expect(checkById(withError.report.checks, 'presence')).toBe(undefined);
	});

	it('holds a second audit on the cooldown, per account, and releases it after', async () => {
		let nowMs = 1_000_000;
		const browse = browsing(GOOD_SITE);
		const service = createWebsiteAuditService(CONFIG, {
			webBrowse: browse,
			webSearch: DISABLED_SEARCH,
			now: () => nowMs,
		});
		const first = account();
		const second = account();

		expect((await service.audit({ account: first, faqCount: 0 })).kind).toBe('report');
		// Immediately again → cooldown, with minutes-to-wait, and no second fetch.
		nowMs += 60_000;
		const held = await service.audit({ account: first, faqCount: 0 });
		expect(held).toEqual({ kind: 'cooldown', retryInMinutes: 9 });
		expect(browse.urls).toHaveLength(1);
		// A different account is not held by the first one's cooldown.
		expect((await service.audit({ account: second, faqCount: 0 })).kind).toBe('report');
		// Once the window passes, the first account audits again.
		nowMs += 10 * 60_000;
		expect((await service.audit({ account: first, faqCount: 0 })).kind).toBe('report');
	});

	it('spends the cooldown on an unreachable attempt too (it cost a fetch)', async () => {
		let nowMs = 5_000_000;
		const service = createWebsiteAuditService(CONFIG, {
			webBrowse: browsing(new Error('down')),
			webSearch: DISABLED_SEARCH,
			now: () => nowMs,
		});
		const target = account();
		expect((await service.audit({ account: target, faqCount: 0 })).kind).toBe('unreachable');
		nowMs += 60_000;
		expect((await service.audit({ account: target, faqCount: 0 })).kind).toBe('cooldown');
	});
});

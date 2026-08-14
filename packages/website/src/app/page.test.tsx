import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { homeFaqTeasers } from '../lib/faq';
import { industries } from '../lib/industries';
import { features, foundingBenefits, navLinks, pricingTiers, problems } from '../lib/site';
import HomePage from './page';

beforeEach(() => {
	// SiteFooter mounts the live ApiStatus client component, which fetches on
	// mount. These tests don't exercise the network, so hold the request pending
	// (ApiStatus stays in its initial state) to avoid an unawaited state update.
	vi.stubGlobal(
		'fetch',
		vi.fn<typeof globalThis.fetch>().mockReturnValue(new Promise<Response>(() => {})),
	);
});

describe('HomePage', () => {
	it('leads with the hero headline', () => {
		render(<HomePage />);
		const heading = screen.getByRole('heading', { level: 1 });
		expect(heading.textContent).toContain('Never miss another');
	});

	it('renders every problem, feature, founding benefit and pricing tier', () => {
		render(<HomePage />);
		for (const problem of problems) {
			expect(screen.getByText(problem.title)).toBeTruthy();
		}
		for (const feature of features) {
			expect(screen.getByText(feature.title)).toBeTruthy();
		}
		for (const benefit of foundingBenefits) {
			expect(screen.getByText(benefit.title)).toBeTruthy();
		}
		for (const tier of pricingTiers) {
			expect(screen.getByText(tier.name)).toBeTruthy();
		}
	});

	it('makes no unsubstantiated claims (ratings, measured speeds, invented customers)', () => {
		render(<HomePage />);
		// The claims pass (WEBSITE_CONTENT_PLAN.md, Phase 4) removed these; they
		// only return with real data behind them.
		expect(screen.queryByText(/1,200\+/)).toBeNull();
		expect(screen.queryByText(/4\.8/)).toBeNull();
		expect(screen.queryByText(/answered in 11s/i)).toBeNull();
		expect(screen.queryByText(/Cascade Plumbing & Heating/)).toBeNull();
		expect(screen.queryByText(/\$420 paid/)).toBeNull();
	});

	it('has an in-page anchor for every hash nav link', () => {
		render(<HomePage />);
		for (const link of navLinks) {
			const hashIndex = link.href.indexOf('#');
			if (hashIndex === -1) {
				// Real pages (FAQ) are asserted via the sitemap / metadata suites.
				expect(link.href.startsWith('/')).toBe(true);
				continue;
			}
			// nav hrefs are root-relative (e.g. "/#features") so they also work from
			// the legal pages; the fragment must resolve to a section on the home page.
			expect(document.getElementById(link.href.slice(hashIndex + 1))).not.toBeNull();
		}
	});

	it('renders an icon glyph in every problem, feature, and founding-benefit tile', () => {
		const { container } = render(<HomePage />);
		// Guards the data-driven Icon (name -> glyph) path, not just adjacent text.
		expect(container.querySelectorAll('.tile svg')).toHaveLength(
			problems.length + features.length + foundingBenefits.length,
		);
	});

	it('surfaces the live API status indicator', () => {
		render(<HomePage />);
		expect(screen.getByRole('status')).toBeTruthy();
	});

	it('links every trust-bar trade name to its industry page', () => {
		const { container } = render(<HomePage />);
		const trust = container.querySelector('.trust');
		expect(trust).not.toBeNull();
		for (const industry of industries) {
			expect(
				within(trust as HTMLElement)
					.getByRole('link', { name: industry.shortName })
					.getAttribute('href'),
			).toBe(`/industries/${industry.slug}`);
		}
	});

	it('gives every trade a home-page card that deep-links to its landing page', () => {
		render(<HomePage />);
		expect(
			screen.getByRole('heading', { level: 2, name: /see rivus in your world/i }),
		).toBeTruthy();
		for (const industry of industries) {
			expect(
				screen.getByRole('link', { name: `Rivus for ${industry.shortName}` }).getAttribute('href'),
			).toBe(`/industries/${industry.slug}`);
		}
	});

	it('answers the owner-objection FAQs on the page and emits matching FAQPage JSON-LD', () => {
		render(<HomePage />);
		for (const entry of homeFaqTeasers) {
			expect(screen.getByText(entry.question)).toBeTruthy();
		}
		const payloads = [...document.querySelectorAll('script[type="application/ld+json"]')].map(
			(script) => JSON.parse(script.textContent ?? '{}'),
		);
		const graph = payloads.find((data) => Array.isArray(data['@graph']));
		const faq = payloads.find((data) => data['@type'] === 'FAQPage');
		expect(graph?.['@graph'].map((node: { '@type': string }) => node['@type'])).toEqual([
			'Organization',
			'WebSite',
			'SoftwareApplication',
		]);
		const application = graph?.['@graph'].find(
			(node: { '@type': string }) => node['@type'] === 'SoftwareApplication',
		) as {
			offers: Array<{ name: string; price: string; description: string; highPrice?: string }>;
		};
		expect(application.offers).toHaveLength(pricingTiers.length);
		expect(application.offers.every((offer) => offer.highPrice === undefined)).toBe(true);
		expect(
			application.offers.find((offer) => offer.name === 'Multi-location')?.description,
		).toMatch(/179/);
		expect(faq?.mainEntity).toHaveLength(homeFaqTeasers.length);
		expect(faq?.mainEntity[0].name).toBe(homeFaqTeasers[0]?.question);
		expect(faq?.mainEntity[0].acceptedAnswer.text).toBe(homeFaqTeasers[0]?.answer);
	});

	it('points owners at compare, the apps page, and the full FAQ', () => {
		render(<HomePage />);
		expect(
			screen
				.getByRole('link', { name: /how that compares with an answering service/i })
				.getAttribute('href'),
		).toBe('/compare');
		expect(
			screen
				.getByRole('link', { name: /iphone and android apps on the way/i })
				.getAttribute('href'),
		).toBe('/apps');
		expect(
			screen
				.getByRole('link', { name: /more questions answered in the faq/i })
				.getAttribute('href'),
		).toBe('/faq');
	});
});

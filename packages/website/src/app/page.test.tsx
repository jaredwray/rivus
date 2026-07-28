import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

	it('has an in-page anchor for every primary nav link', () => {
		render(<HomePage />);
		for (const link of navLinks) {
			// nav hrefs are root-relative (e.g. "/#features") so they also work from
			// the legal pages; the fragment must resolve to a section on the home page.
			expect(document.getElementById(link.href.replace('/#', ''))).not.toBeNull();
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
		render(<HomePage />);
		for (const industry of industries) {
			expect(screen.getByRole('link', { name: industry.shortName }).getAttribute('href')).toBe(
				`/industries/${industry.slug}`,
			);
		}
	});
});

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { industries } from '../lib/industries';
import { features, navLinks, pricingTiers, problems, testimonials } from '../lib/site';
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

	it('renders every problem, feature, testimonial and pricing tier', () => {
		render(<HomePage />);
		for (const problem of problems) {
			expect(screen.getByText(problem.title)).toBeTruthy();
		}
		for (const feature of features) {
			expect(screen.getByText(feature.title)).toBeTruthy();
		}
		for (const testimonial of testimonials) {
			expect(screen.getByText(testimonial.business)).toBeTruthy();
		}
		for (const tier of pricingTiers) {
			expect(screen.getByText(tier.name)).toBeTruthy();
		}
	});

	it('has an in-page anchor for every primary nav link', () => {
		render(<HomePage />);
		for (const link of navLinks) {
			// nav hrefs are root-relative (e.g. "/#features") so they also work from
			// the legal pages; the fragment must resolve to a section on the home page.
			expect(document.getElementById(link.href.replace('/#', ''))).not.toBeNull();
		}
	});

	it('renders an icon glyph in every problem and feature tile', () => {
		const { container } = render(<HomePage />);
		// Guards the data-driven Icon (name -> glyph) path, not just adjacent text.
		expect(container.querySelectorAll('.tile svg')).toHaveLength(problems.length + features.length);
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

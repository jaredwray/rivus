import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findIndustry, industries } from '../lib/industries';
import { industryPageMeta, industryStaticParams } from '../lib/meta';
import { signupUrl } from '../lib/site';
import { IndustryPage, requireIndustry } from './industry-page';

beforeEach(() => {
	// The shared footer mounts ApiStatus, which fetches on mount; hold it pending.
	vi.stubGlobal(
		'fetch',
		vi.fn<typeof globalThis.fetch>().mockReturnValue(new Promise<Response>(() => {})),
	);
});

describe('IndustryPage', () => {
	it('statically generates every trade from the industries data', () => {
		expect(industryStaticParams()).toEqual(industries.map(({ slug }) => ({ slug })));
	});

	it.each(
		industries.map((industry) => [industry.slug, industry] as const),
	)('renders the full %s page from its data', (_slug, industry) => {
		render(<IndustryPage industry={industry} />);

		expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(industry.title);
		for (const pain of industry.pains) {
			expect(screen.getByText(pain.title)).toBeTruthy();
		}
		for (const item of industry.handles) {
			expect(screen.getByText(item)).toBeTruthy();
		}
		// The illustrative conversation, end to end.
		expect(screen.getByText(industry.conversation.inbound)).toBeTruthy();
		expect(screen.getByText(industry.conversation.reply)).toBeTruthy();
		expect(screen.getByText(industry.conversation.bookedSub)).toBeTruthy();
		// Conversion CTAs — the hero action and FinalCta both sell signup.
		const signupLinks = screen.getAllByRole('link', { name: /get started free/i });
		expect(signupLinks.length).toBeGreaterThanOrEqual(2);
		for (const link of signupLinks) {
			expect(link.getAttribute('href')).toBe(signupUrl);
		}
		expect(screen.getByRole('link', { name: 'See pricing' }).getAttribute('href')).toBe(
			'/#pricing',
		);
	});

	it('builds trade-specific metadata with a canonical', () => {
		const metadata = industryPageMeta('plumbers');
		expect(metadata.title).toBe('Rivus for Plumbers — the AI agent that runs your front office');
		expect(metadata.description).toBe(findIndustry('plumbers')?.metaDescription);
		expect(metadata.canonical).toBe('/industries/plumbers');
	});

	it('404s an unknown trade', () => {
		expect(() => requireIndustry('astronauts')).toThrow(/not found/i);
		expect(industryPageMeta('astronauts').title).toBe('Page not found — Rivus');
	});
});

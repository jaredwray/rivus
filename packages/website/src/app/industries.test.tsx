import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findIndustry, industries } from '../lib/industries';
import { signupUrl } from '../lib/site';
import IndustryPage, { generateMetadata, generateStaticParams } from './industries/[slug]/page';

beforeEach(() => {
	// The shared footer mounts ApiStatus, which fetches on mount; hold it pending.
	vi.stubGlobal(
		'fetch',
		vi.fn<typeof globalThis.fetch>().mockReturnValue(new Promise<Response>(() => {})),
	);
});

function pageProps(slug: string) {
	// Next 16 delivers params as a Promise; the page awaits it.
	return { params: Promise.resolve({ slug }) };
}

describe('IndustryPage', () => {
	it('statically generates every trade from the industries data', () => {
		expect(generateStaticParams()).toEqual(industries.map(({ slug }) => ({ slug })));
	});

	it.each(
		industries.map((industry) => [industry.slug, industry] as const),
	)('renders the full %s page from its data', async (_slug, industry) => {
		render(await IndustryPage(pageProps(industry.slug)));

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

	it('builds trade-specific metadata', async () => {
		const metadata = await generateMetadata(pageProps('plumbers'));
		expect(metadata.title).toBe('Rivus for Plumbers — the AI agent that runs your front office');
		expect(metadata.description).toBe(findIndustry('plumbers')?.metaDescription);
	});

	it('404s an unknown trade', async () => {
		await expect(IndustryPage(pageProps('astronauts'))).rejects.toThrow();
		expect((await generateMetadata(pageProps('astronauts'))).title).toBe('Page not found — Rivus');
	});
});

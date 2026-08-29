import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Pricing } from '../components/marketing/pricing';
import { allFaqEntries, faqCategories, faqCategoryAnchor, homeFaqTeasers } from '../lib/faq';
import { FaqPage } from './faq-page';

beforeEach(() => {
	// The shared footer mounts ApiStatus, which fetches on mount; hold it pending.
	vi.stubGlobal(
		'fetch',
		vi.fn<typeof globalThis.fetch>().mockReturnValue(new Promise<Response>(() => {})),
	);
});

describe('FaqPage', () => {
	it('renders every category with an anchor and every question and answer', () => {
		render(<FaqPage />);
		for (const category of faqCategories) {
			expect(screen.getByRole('heading', { level: 2, name: category.title })).toBeTruthy();
			expect(document.getElementById(faqCategoryAnchor(category))).not.toBeNull();
			for (const entry of category.entries) {
				expect(screen.getByText(entry.question)).toBeTruthy();
				expect(screen.getByText(entry.answer)).toBeTruthy();
			}
		}
	});

	it('offers the demo and the human as next steps', () => {
		render(<FaqPage />);
		// The hero CTA and the footer's Product column both offer the demo.
		const demoLinks = screen.getAllByRole('link', { name: /book a demo/i });
		expect(demoLinks.length).toBeGreaterThanOrEqual(1);
		for (const link of demoLinks) {
			expect(link.getAttribute('href')).toBe('/demo');
		}
		expect(screen.getByRole('link', { name: 'Ask a human' }).getAttribute('href')).toBe('/contact');
	});

	it('emits FAQPage structured data matching the rendered entries', () => {
		render(<FaqPage />);
		const script = document.querySelector('script[type="application/ld+json"]');
		expect(script).not.toBeNull();
		const data = JSON.parse(script?.textContent ?? '{}');
		expect(data['@type']).toBe('FAQPage');
		expect(data.mainEntity).toHaveLength(allFaqEntries.length);
		expect(data.mainEntity[0].name).toBe(allFaqEntries[0]?.question);
		expect(data.mainEntity[0].acceptedAnswer.text).toBe(allFaqEntries[0]?.answer);
	});
});

describe('Pricing → FAQ strip', () => {
	it('sources home teasers from the canonical FAQ entries', () => {
		expect(homeFaqTeasers).toHaveLength(5);
		for (const teaser of homeFaqTeasers) {
			expect(allFaqEntries).toContainEqual(teaser);
		}
	});

	it('teases the owner-objection questions and links the full FAQ and compare page', () => {
		render(<Pricing />);
		expect(homeFaqTeasers.length).toBeGreaterThan(0);
		for (const entry of homeFaqTeasers) {
			expect(screen.getByText(entry.question)).toBeTruthy();
		}
		expect(
			screen
				.getByRole('link', { name: /more questions answered in the faq/i })
				.getAttribute('href'),
		).toBe('/faq');
		expect(
			screen.getByRole('link', { name: /compare with an answering service/i }).getAttribute('href'),
		).toBe('/compare');
	});
});

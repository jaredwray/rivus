import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { legalDocs, privacyDoc, securityDoc, termsDoc } from '../lib/legal';
import PrivacyPage from './privacy/page';
import SecurityPage from './security/page';
import TermsPage from './terms/page';

beforeEach(() => {
	// The shared footer mounts ApiStatus, which fetches on mount; hold it pending.
	vi.stubGlobal(
		'fetch',
		vi.fn<typeof globalThis.fetch>().mockReturnValue(new Promise<Response>(() => {})),
	);
});

const pages = [
	{ name: 'privacy', Page: PrivacyPage, doc: privacyDoc },
	{ name: 'terms', Page: TermsPage, doc: termsDoc },
	{ name: 'security', Page: SecurityPage, doc: securityDoc },
];

describe('legal pages', () => {
	it.each(pages)('$name renders its title, every section, and a contact link', ({ Page, doc }) => {
		render(<Page />);
		expect(screen.getByRole('heading', { level: 1, name: doc.title })).toBeTruthy();
		for (const section of doc.sections) {
			expect(screen.getByRole('heading', { level: 2, name: section.heading })).toBeTruthy();
		}
		expect(screen.getByRole('link', { name: doc.contactEmail }).getAttribute('href')).toBe(
			`mailto:${doc.contactEmail}`,
		);
	});

	it('serves a document for every slug with a rivus.ai contact email', () => {
		for (const slug of ['privacy', 'terms', 'security'] as const) {
			expect(legalDocs[slug].slug).toBe(slug);
			expect(legalDocs[slug].contactEmail).toMatch(/@rivus\.ai$/);
			expect(legalDocs[slug].sections.length).toBeGreaterThan(0);
		}
	});
});

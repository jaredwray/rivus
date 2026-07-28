import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { brandAssets, brandGuidelinesPdf, pressEmail, pressFacts } from '../lib/press';
import ContactPage from './contact/page';
import PressPage from './press/page';

beforeEach(() => {
	// The shared footer mounts ApiStatus, which fetches on mount; hold it pending.
	vi.stubGlobal(
		'fetch',
		vi.fn<typeof globalThis.fetch>().mockReturnValue(new Promise<Response>(() => {})),
	);
});

describe('PressPage', () => {
	it('renders the boilerplate, every fast fact, and the press CTA', () => {
		render(<PressPage />);
		expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Writing about Rivus');
		for (const fact of pressFacts) {
			expect(screen.getByRole('heading', { level: 3, name: fact.title })).toBeTruthy();
		}
		expect(screen.getByRole('link', { name: new RegExp(pressEmail) }).getAttribute('href')).toBe(
			`mailto:${pressEmail}`,
		);
	});

	it('offers every brand-asset download plus the guidelines PDF', () => {
		render(<PressPage />);
		for (const asset of brandAssets) {
			expect(screen.getByRole('heading', { level: 3, name: asset.name })).toBeTruthy();
		}
		const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
		for (const file of brandAssets.flatMap((asset) => asset.files)) {
			expect(hrefs).toContain(file.href);
		}
		expect(hrefs).toContain(brandGuidelinesPdf);
	});
});

describe('ContactPage → press kit', () => {
	it('routes the press card to the on-site press page', () => {
		render(<ContactPage />);
		expect(
			screen.getByRole('link', { name: /press kit & brand assets/i }).getAttribute('href'),
		).toBe('/press');
	});
});

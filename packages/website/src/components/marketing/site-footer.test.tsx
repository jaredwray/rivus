import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { docsUrl, footerColumns } from '../../lib/site';
import { SiteFooter } from './site-footer';

beforeEach(() => {
	// The footer mounts ApiStatus, which fetches on mount; hold it pending.
	vi.stubGlobal(
		'fetch',
		vi.fn<typeof globalThis.fetch>().mockReturnValue(new Promise<Response>(() => {})),
	);
});

describe('SiteFooter', () => {
	it('renders every configured column and link', () => {
		render(<SiteFooter />);
		for (const column of footerColumns) {
			expect(screen.getByText(column.title)).toBeTruthy();
			for (const link of column.links) {
				expect(screen.getByRole('link', { name: link.label }).getAttribute('href')).toBe(link.href);
			}
		}
	});

	it('links the docs deploy from the Resources column', () => {
		render(<SiteFooter />);
		expect(screen.getByRole('link', { name: 'Docs' }).getAttribute('href')).toBe(docsUrl);
		expect(screen.getByRole('link', { name: 'API reference' }).getAttribute('href')).toBe(
			`${docsUrl}/api`,
		);
		expect(screen.getByRole('link', { name: 'Changelog' }).getAttribute('href')).toBe(
			`${docsUrl}/changelog`,
		);
	});

	it('renders external links as plain anchors (rel), internal ones without it', () => {
		render(<SiteFooter />);
		for (const link of footerColumns.flatMap((column) => column.links)) {
			const anchor = screen.getByRole('link', { name: link.label });
			if (link.href.startsWith('/')) {
				expect(anchor.getAttribute('rel')).toBeNull();
			} else {
				expect(anchor.getAttribute('rel')).toBe('noreferrer');
			}
		}
	});
});

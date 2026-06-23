import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { appUrl } from '../../lib/site';
import { SiteNav } from './site-nav';

describe('SiteNav', () => {
	it('sends every "Sign in" link to the product app, not a local route', () => {
		render(<SiteNav />);
		const signIns = screen.getAllByRole('link', { name: 'Sign in' });
		expect(signIns.length).toBeGreaterThan(0);
		for (const link of signIns) {
			expect(link.getAttribute('href')).toBe(`${appUrl}/login`);
		}
	});

	it('toggles the mobile menu open and closed', () => {
		const { container } = render(<SiteNav />);
		const nav = container.querySelector('nav');
		const button = screen.getByRole('button', { name: /toggle menu/i });

		expect(button.getAttribute('aria-expanded')).toBe('false');
		expect(nav?.className).toBe('nav');

		fireEvent.click(button);
		expect(button.getAttribute('aria-expanded')).toBe('true');
		expect(nav?.className).toContain('nav--open');

		fireEvent.click(button);
		expect(button.getAttribute('aria-expanded')).toBe('false');
		expect(nav?.className).toBe('nav');
	});

	it('closes the menu when a mobile link is chosen', () => {
		const { container } = render(<SiteNav />);
		const nav = container.querySelector('nav');
		fireEvent.click(screen.getByRole('button', { name: /toggle menu/i }));
		expect(nav?.className).toContain('nav--open');

		const mobileMenu = container.querySelector('#nav-mobile');
		const firstLink = mobileMenu?.querySelector('a');
		if (!firstLink) {
			throw new Error('expected a mobile menu link');
		}
		fireEvent.click(firstLink);
		expect(nav?.className).toBe('nav');
	});
});

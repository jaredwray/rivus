import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AboutPage from './about/page';
import AppsPage from './apps/page';
import CareersPage from './careers/page';
import ContactPage from './contact/page';

beforeEach(() => {
	// The shared footer mounts ApiStatus, which fetches on mount; hold it pending.
	vi.stubGlobal(
		'fetch',
		vi.fn<typeof globalThis.fetch>().mockReturnValue(new Promise<Response>(() => {})),
	);
});

const pages = [
	{ name: 'apps', Page: AppsPage, title: 'Rivus on every device', email: null },
	{ name: 'about', Page: AboutPage, title: 'About Rivus', email: null },
	{ name: 'careers', Page: CareersPage, title: 'Work at Rivus', email: 'careers@rivus.ai' },
	{ name: 'contact', Page: ContactPage, title: 'Get in touch', email: 'hello@rivus.ai' },
];

describe('info "coming soon" pages', () => {
	it.each(pages)('$name renders its title and a link back home', ({ Page, title }) => {
		render(<Page />);
		expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
		expect(screen.getByRole('link', { name: /back to home/i }).getAttribute('href')).toBe('/');
	});

	it.each(pages.filter((page) => page.email))('$name exposes a mailto link to $email', ({
		Page,
		email,
	}) => {
		render(<Page />);
		expect(screen.getByRole('link', { name: email as string }).getAttribute('href')).toBe(
			`mailto:${email}`,
		);
	});

	it('omits the email footnote when no address is given', () => {
		render(<AppsPage />);
		expect(screen.queryByText(/prefer email/i)).toBeNull();
	});
});

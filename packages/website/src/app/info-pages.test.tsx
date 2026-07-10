import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	appPlatforms,
	careersEmail,
	careersValues,
	companyStats,
	companyValues,
	contactChannels,
} from '../lib/company';
import { appUrl } from '../lib/site';
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

describe('AboutPage', () => {
	it('renders the story, every company stat, and every value', () => {
		render(<AboutPage />);
		expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Local business');
		for (const stat of companyStats) {
			expect(screen.getByText(stat.value)).toBeTruthy();
			expect(screen.getByText(stat.label)).toBeTruthy();
		}
		for (const value of companyValues) {
			expect(screen.getByText(value.title)).toBeTruthy();
		}
	});

	it('ends in the shared sign-up CTA', () => {
		render(<AboutPage />);
		expect(screen.getByRole('link', { name: /get started free/i }).getAttribute('href')).toBe(
			`${appUrl}/signup`,
		);
	});
});

describe('CareersPage', () => {
	it('renders every team value and routes both CTAs to the careers inbox', () => {
		render(<CareersPage />);
		for (const value of careersValues) {
			expect(screen.getByText(value.title)).toBeTruthy();
		}
		const mailtos = screen
			.getAllByRole('link')
			.filter((link) => link.getAttribute('href') === `mailto:${careersEmail}`);
		// The hero "Introduce yourself" button and the empty-state email button.
		expect(mailtos.length).toBeGreaterThanOrEqual(2);
	});

	it('is honest about having no open roles', () => {
		render(<CareersPage />);
		expect(screen.getByText(/nothing posted right now/i)).toBeTruthy();
	});
});

describe('ContactPage', () => {
	it('renders a mailto card for every contact channel', () => {
		render(<ContactPage />);
		for (const channel of contactChannels) {
			// Heading role keeps "Security" from also matching the footer link.
			expect(screen.getByRole('heading', { level: 3, name: channel.title })).toBeTruthy();
			expect(
				screen.getByRole('link', { name: new RegExp(channel.email) }).getAttribute('href'),
			).toBe(`mailto:${channel.email}`);
		}
	});

	it('offers a demo booking that goes to the product app', () => {
		render(<ContactPage />);
		expect(screen.getByRole('link', { name: /book a demo/i }).getAttribute('href')).toBe(
			`${appUrl}/demo`,
		);
	});
});

describe('AppsPage', () => {
	it('renders every platform with its availability', () => {
		render(<AppsPage />);
		for (const platform of appPlatforms) {
			expect(screen.getByText(platform.name)).toBeTruthy();
		}
		expect(screen.getByText('Available now')).toBeTruthy();
		expect(screen.getAllByText('Coming soon')).toHaveLength(
			appPlatforms.filter((platform) => platform.status === 'soon').length,
		);
	});

	it('links the live platform to the product app', () => {
		render(<AppsPage />);
		const appLinks = screen
			.getAllByRole('link')
			.filter((link) => link.getAttribute('href') === appUrl);
		// Hero CTA plus the web-app platform card.
		expect(appLinks.length).toBeGreaterThanOrEqual(2);
	});
});

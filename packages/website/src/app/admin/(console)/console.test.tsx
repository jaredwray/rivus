import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: vi.fn(() => '/admin') }));

import { usePathname } from 'next/navigation';
import { adminNav } from '../../../lib/admin';
import AccountsPage from './accounts/page';
import EscalationsPage from './escalations/page';
import ConsoleLayout from './layout';
import OnboardingPage from './onboarding/page';
import OverviewPage from './page';

const mockedPathname = vi.mocked(usePathname);

beforeEach(() => {
	mockedPathname.mockReturnValue('/admin');
});

afterEach(() => {
	mockedPathname.mockReset();
	mockedPathname.mockReturnValue('/admin');
});

describe('console chrome', () => {
	it('renders every nav item in both the sidebar and bottom nav', () => {
		render(
			<ConsoleLayout>
				<div>screen body</div>
			</ConsoleLayout>,
		);
		for (const item of adminNav) {
			// Once in the desktop sidebar, once in the mobile bottom nav.
			expect(screen.getAllByText(item.label).length).toBeGreaterThanOrEqual(2);
		}
		expect(screen.getByText('screen body')).toBeTruthy();
	});

	it('marks the active route with aria-current', () => {
		mockedPathname.mockReturnValue('/admin/escalations');
		render(
			<ConsoleLayout>
				<div>body</div>
			</ConsoleLayout>,
		);
		const escalationLinks = screen.getAllByRole('link', { name: /Escalations/ });
		expect(escalationLinks.some((link) => link.getAttribute('aria-current') === 'page')).toBe(true);
		const overviewLinks = screen.getAllByRole('link', { name: /Overview/ });
		expect(overviewLinks.every((link) => link.getAttribute('aria-current') !== 'page')).toBe(true);
	});
});

describe('console screens', () => {
	it('overview shows the greeting and a KPI', () => {
		render(<OverviewPage />);
		expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Good morning');
		expect(screen.getByText('Active accounts')).toBeTruthy();
		expect(screen.getByText('Accounts by plan')).toBeTruthy();
	});

	it('accounts lists account names (table + cards)', () => {
		render(<AccountsPage />);
		expect(screen.getByRole('heading', { level: 1, name: 'Accounts' })).toBeTruthy();
		expect(screen.getAllByText('Cascade Plumbing & Heating').length).toBeGreaterThanOrEqual(1);
	});

	it('onboarding lists businesses in setup', () => {
		render(<OnboardingPage />);
		expect(screen.getByRole('heading', { level: 1, name: 'Onboarding' })).toBeTruthy();
		expect(screen.getByText('Live this week')).toBeTruthy();
		expect(screen.getByText('Hometown Pizza Co')).toBeTruthy();
	});

	it('escalations lists flagged items', () => {
		render(<EscalationsPage />);
		expect(screen.getByRole('heading', { level: 1, name: 'Escalations' })).toBeTruthy();
		expect(screen.getByText('Customer disputes $60 on invoice #1051')).toBeTruthy();
	});
});

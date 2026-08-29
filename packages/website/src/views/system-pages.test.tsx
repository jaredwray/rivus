import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoPage } from './demo-page';
import { ErrorPage } from './error-page';
import { NotFoundPage } from './not-found-page';

beforeEach(() => {
	// The shared footer mounts ApiStatus, which fetches on mount; hold it pending.
	vi.stubGlobal(
		'fetch',
		vi.fn<typeof globalThis.fetch>().mockReturnValue(new Promise<Response>(() => {})),
	);
});

describe('DemoPage', () => {
	it('renders the hero and the request form', () => {
		render(<DemoPage />);
		expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Watch Rivus answer');
		expect(screen.getByRole('form', { name: 'Request a demo' })).toBeTruthy();
	});
});

describe('NotFoundPage', () => {
	it('offers the two ways back: home and contact', () => {
		render(<NotFoundPage />);
		expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('off the schedule');
		expect(screen.getByRole('link', { name: 'Back to the home page' }).getAttribute('href')).toBe(
			'/',
		);
		expect(screen.getByRole('link', { name: 'Contact us' }).getAttribute('href')).toBe('/contact');
	});
});

describe('ErrorPage', () => {
	it('announces the failure and retries via the reset callback', () => {
		const reset = vi.fn();
		render(<ErrorPage error={new Error('boom')} reset={reset} />);

		expect(screen.getByRole('alert').textContent).toContain("wasn't supposed to happen");
		fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
		expect(reset).toHaveBeenCalledTimes(1);
	});

	it('keeps an escape hatch to support and home', () => {
		render(<ErrorPage error={new Error('boom')} reset={() => {}} />);
		expect(screen.getByRole('link', { name: /support@rivus\.ai/i })).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Back to the home page' }).getAttribute('href')).toBe(
			'/',
		);
	});
});

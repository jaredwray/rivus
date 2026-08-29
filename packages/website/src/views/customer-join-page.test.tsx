import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { customerJoinMeta } from '../lib/meta';
import { apiUrl } from '../lib/site';
import { CustomerJoinPage } from './customer-join-page';

beforeEach(() => {
	// Both the join form's account lookup and the footer's ApiStatus fetch on
	// mount; hold the requests pending so the page stays in its initial state.
	vi.stubGlobal(
		'fetch',
		vi.fn<typeof globalThis.fetch>().mockReturnValue(new Promise<Response>(() => {})),
	);
});

describe('CustomerJoinPage', () => {
	it('renders the site chrome and mounts the join form for the routed slug', () => {
		render(<CustomerJoinPage slug="cascade-plumbing" />);

		expect(screen.getByRole('link', { name: 'Rivus home' })).toBeTruthy();
		expect(screen.getByText('Looking up the business…')).toBeTruthy();
		expect(screen.getByText(/all rights reserved/i)).toBeTruthy();
		expect(globalThis.fetch).toHaveBeenCalledWith(`${apiUrl}/v1/public/accounts/cascade-plumbing`);
	});

	it('is titled for the join flow and kept out of search indexes', () => {
		expect(customerJoinMeta.title).toBe('Join as a customer — Rivus');
		expect(customerJoinMeta.robots).toEqual({ index: false, follow: false });
	});
});

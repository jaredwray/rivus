import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomerJoinFromPath } from './customer-join-from-path';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('CustomerJoinFromPath', () => {
	it('reads the account slug from the visible URL and starts the lookup', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn<typeof globalThis.fetch>().mockReturnValue(new Promise<Response>(() => {})),
		);
		vi.spyOn(window, 'location', 'get').mockReturnValue({
			pathname: '/customers/join/cascade-plumbing',
			search: '?email=dana%40example.com',
		} as Location);

		render(<CustomerJoinFromPath />);
		expect(await screen.findByText('Looking up the business…')).toBeTruthy();
		expect(globalThis.fetch).toHaveBeenCalledWith(
			expect.stringContaining('/v1/public/accounts/cascade-plumbing'),
		);
	});

	it('shows not-found when the path has no slug', async () => {
		vi.spyOn(window, 'location', 'get').mockReturnValue({
			pathname: '/customers/join',
			search: '',
		} as Location);

		render(<CustomerJoinFromPath />);
		expect(
			await screen.findByRole('heading', { name: /couldn't find this business/i }),
		).toBeTruthy();
	});
});

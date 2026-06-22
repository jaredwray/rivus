import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiStatus } from './api-status';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('ApiStatus', () => {
	it('shows online when the API responds ok', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{}', { status: 200 })),
		);

		render(<ApiStatus />);

		await waitFor(() =>
			expect(screen.getByRole('status').getAttribute('data-status')).toBe('online'),
		);
	});

	it('shows offline when the request fails', async () => {
		vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('down')));

		render(<ApiStatus />);

		await waitFor(() =>
			expect(screen.getByRole('status').getAttribute('data-status')).toBe('offline'),
		);
	});

	it('shows offline when the API responds with a non-ok status', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{}', { status: 503 })),
		);

		render(<ApiStatus />);

		await waitFor(() =>
			expect(screen.getByRole('status').getAttribute('data-status')).toBe('offline'),
		);
	});
});

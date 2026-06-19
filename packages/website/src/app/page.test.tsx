import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { features } from '../lib/site';
import HomePage from './page';

beforeEach(() => {
	vi.stubGlobal(
		'fetch',
		vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{}', { status: 200 })),
	);
});

describe('HomePage', () => {
	it('renders the hero heading', () => {
		render(<HomePage />);
		expect(screen.getByRole('heading', { level: 1, name: 'Rivus' })).toBeTruthy();
	});

	it('renders a card for every feature', () => {
		render(<HomePage />);
		expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(features.length);
	});
});

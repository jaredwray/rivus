import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compareColumns, compareRows } from '../lib/compare';
import { pageMeta } from '../lib/meta';
import { ComparePage } from './compare-page';

beforeEach(() => {
	// The shared footer mounts ApiStatus, which fetches on mount; hold it pending.
	vi.stubGlobal(
		'fetch',
		vi.fn<typeof globalThis.fetch>().mockReturnValue(new Promise<Response>(() => {})),
	);
});

describe('ComparePage', () => {
	it('renders every column, every dimension, and every Rivus cell', () => {
		render(<ComparePage />);
		for (const column of compareColumns) {
			expect(screen.getByText(column.name)).toBeTruthy();
			expect(screen.getByText(column.summary)).toBeTruthy();
		}
		for (const row of compareRows) {
			expect(screen.getByRole('rowheader', { name: row.dimension })).toBeTruthy();
			expect(screen.getByText(row.rivus)).toBeTruthy();
		}
	});

	it('keeps the honest caveat about a great human front desk', () => {
		render(<ComparePage />);
		expect(screen.getByText(/a great front-desk person is irreplaceable/i)).toBeTruthy();
	});

	it('names no competitors and quotes no external prices', () => {
		// The claims rules: structural comparisons only. Guard the data itself so
		// a future edit can't slip a named competitor or invented figure in.
		const cells = compareRows.flatMap((row) => [row.hire, row.service, row.voicemail]);
		for (const cell of cells) {
			expect(cell).not.toMatch(/\$\d/);
		}
	});

	it('declares its canonical URL', () => {
		expect(pageMeta['/compare']?.canonical).toBe('/compare');
	});
});

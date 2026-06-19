import { describe, expect, it } from 'vitest';
import { buildPaginationMeta, normalizePagination, pageToSkip } from './pagination';

describe('normalizePagination', () => {
	it('keeps valid input untouched', () => {
		expect(normalizePagination(3, 25)).toEqual({ page: 3, pageSize: 25 });
	});

	it('clamps a page below 1 up to 1', () => {
		expect(normalizePagination(0, 10).page).toBe(1);
		expect(normalizePagination(-5, 10).page).toBe(1);
	});

	it('clamps pageSize to the maximum', () => {
		expect(normalizePagination(1, 1000).pageSize).toBe(100);
		expect(normalizePagination(1, 1000, { maxPageSize: 50 }).pageSize).toBe(50);
	});

	it('clamps pageSize below 1 up to 1', () => {
		expect(normalizePagination(1, 0).pageSize).toBe(1);
	});

	it('truncates fractional values', () => {
		expect(normalizePagination(2.9, 10.7)).toEqual({ page: 2, pageSize: 10 });
	});

	it('falls back to defaults for NaN and Infinity', () => {
		expect(normalizePagination(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({
			page: 1,
			pageSize: 1,
		});
	});
});

describe('pageToSkip', () => {
	it('returns 0 for the first page', () => {
		expect(pageToSkip(1, 20)).toBe(0);
	});

	it('skips whole pages', () => {
		expect(pageToSkip(3, 20)).toBe(40);
	});

	it('normalizes before computing', () => {
		expect(pageToSkip(-1, 20)).toBe(0);
	});
});

describe('buildPaginationMeta', () => {
	it('computes totalPages with a remainder', () => {
		const meta = buildPaginationMeta({ page: 1, pageSize: 20, total: 45 });
		expect(meta.totalPages).toBe(3);
		expect(meta.hasNextPage).toBe(true);
		expect(meta.hasPreviousPage).toBe(false);
	});

	it('computes totalPages for an exact multiple', () => {
		expect(buildPaginationMeta({ page: 2, pageSize: 20, total: 40 }).totalPages).toBe(2);
	});

	it('flags previous but not next on the last page', () => {
		const meta = buildPaginationMeta({ page: 3, pageSize: 20, total: 45 });
		expect(meta.hasNextPage).toBe(false);
		expect(meta.hasPreviousPage).toBe(true);
	});

	it('handles an empty result set', () => {
		const meta = buildPaginationMeta({ page: 1, pageSize: 20, total: 0 });
		expect(meta).toMatchObject({
			total: 0,
			totalPages: 0,
			hasNextPage: false,
			hasPreviousPage: false,
		});
	});

	it('does not flag a previous page when there are no results', () => {
		expect(buildPaginationMeta({ page: 2, pageSize: 20, total: 0 }).hasPreviousPage).toBe(false);
	});

	it('guards against a negative total', () => {
		expect(buildPaginationMeta({ page: 1, pageSize: 20, total: -5 }).total).toBe(0);
	});

	it('guards against a non-finite total', () => {
		expect(buildPaginationMeta({ page: 1, pageSize: 20, total: Number.NaN }).total).toBe(0);
	});
});

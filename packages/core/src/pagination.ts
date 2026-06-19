import type { PaginationMeta } from './types';

export interface PaginationInput {
	page: number;
	pageSize: number;
	total: number;
}

/** Clamp a requested page/pageSize into safe bounds. */
export function normalizePagination(
	page: number,
	pageSize: number,
	{ maxPageSize = 100 }: { maxPageSize?: number } = {},
): { page: number; pageSize: number } {
	const safePage = Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1;
	const safeSize = Number.isFinite(pageSize)
		? Math.min(maxPageSize, Math.max(1, Math.trunc(pageSize)))
		: 1;
	return { page: safePage, pageSize: safeSize };
}

/** How many documents to skip to reach the start of `page`. */
export function pageToSkip(page: number, pageSize: number): number {
	const normalized = normalizePagination(page, pageSize);
	return (normalized.page - 1) * normalized.pageSize;
}

/** Build the pagination metadata clients use to render controls. */
export function buildPaginationMeta({ page, pageSize, total }: PaginationInput): PaginationMeta {
	const normalized = normalizePagination(page, pageSize);
	const safeTotal = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
	const totalPages = Math.ceil(safeTotal / normalized.pageSize);
	return {
		page: normalized.page,
		pageSize: normalized.pageSize,
		total: safeTotal,
		totalPages,
		hasNextPage: normalized.page < totalPages,
		hasPreviousPage: normalized.page > 1 && totalPages > 0,
	};
}

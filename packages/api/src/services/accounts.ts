import { slugify } from '@rivus/core';
import type { AccountRepository } from '../repositories/types';

/**
 * Derive a URL-safe, unique slug from a business name. Falls back to `account`
 * when the name has no slug-able characters, and appends `-2`, `-3`, … until a
 * free slug is found.
 */
export async function generateUniqueSlug(
	accounts: AccountRepository,
	businessName: string,
): Promise<string> {
	const base = slugify(businessName) || 'account';
	let candidate = base;
	let suffix = 1;
	while (await accounts.findBySlug(candidate)) {
		suffix += 1;
		candidate = `${base}-${suffix}`;
	}
	return candidate;
}

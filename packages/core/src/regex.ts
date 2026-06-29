/**
 * Escape regex metacharacters so a user-supplied string is matched literally — a
 * term like `a.b` or `(206)` is treated as text, not as a pattern (which could
 * also be crafted to run pathologically slowly). Shared by the Mongo repositories,
 * which build case-insensitive search filters with `new RegExp(escapeRegex(term), 'i')`.
 */
export function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

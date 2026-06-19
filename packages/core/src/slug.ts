/**
 * Convert arbitrary text into a URL-safe slug: lowercase, accents stripped,
 * and runs of non-alphanumeric characters collapsed into single hyphens.
 *
 * @example slugify('Héllo, World!') // 'hello-world'
 */
export function slugify(input: string): string {
	return input
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

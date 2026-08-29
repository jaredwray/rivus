/**
 * The public join URL is `/customers/join/<account-slug>`. Unknown slugs are
 * one static page (Cloudflare 200-rewrites the path onto `/customers/join`);
 * the client reads the slug from the visible URL.
 */
export function joinSlugFromPath(pathname: string): string | undefined {
	const parts = pathname.split('/').filter(Boolean);
	if (parts[0] === 'customers' && parts[1] === 'join' && parts[2] && parts.length === 3) {
		return parts[2];
	}
	return undefined;
}

/**
 * Map `/customers/join/<slug>` onto `/customers/join` for the local Vite
 * server. Cloudflare does the same with `public/_redirects`. The visible
 * URL (and therefore `joinSlugFromPath`) is unchanged.
 */
export function rewriteJoinRequestUrl(url: string): string {
	if (!/^\/customers\/join\/[^/?#]+/.test(url)) {
		return url;
	}
	const queryAt = url.indexOf('?');
	return `/customers/join${queryAt === -1 ? '' : url.slice(queryAt)}`;
}

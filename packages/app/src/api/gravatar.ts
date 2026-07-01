import { gravatarUrl } from '@rivus/core';

/**
 * Whether an email has a real Gravatar image, as opposed to the `d=404` fallback
 * Gravatar serves when none is set (see `gravatarUrl`). Pure and RN-free so it's
 * unit-tested under Node with an injected fetch, mirroring `places.ts`.
 */

/** The slice of `fetch` we need, narrowed so tests can pass a simple fake. */
export type GravatarFetch = (input: string, init?: RequestInit) => Promise<{ ok: boolean }>;

export interface HasGravatarOptions {
	fetchImpl?: GravatarFetch;
}

/**
 * Requests the exact URL the `Avatar` component would render and reports whether
 * it resolves (a real Gravatar) or 404s (none set). A `HEAD` request is enough —
 * only the status matters, so this avoids downloading the image body. Any
 * network failure is treated as "no Gravatar" so a flaky check just offers the
 * upload button rather than blocking the profile screen.
 */
export async function hasGravatar(
	email: string,
	options: HasGravatarOptions = {},
): Promise<boolean> {
	const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as GravatarFetch);
	try {
		const response = await fetchImpl(gravatarUrl(email), { method: 'HEAD' });
		return response.ok;
	} catch {
		return false;
	}
}

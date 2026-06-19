/**
 * Resolve the base URL of the Rivus API.
 *
 * `EXPO_PUBLIC_*` vars are inlined by the Expo bundler and are therefore safe to
 * read on the client. We fall back to the local API dev server so the app is
 * runnable out of the box.
 */
export const DEFAULT_API_URL = 'http://localhost:4000';

export function getApiBaseUrl(env: Record<string, string | undefined> = process.env): string {
	const fromEnv = env.EXPO_PUBLIC_API_URL?.trim();
	return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_API_URL;
}

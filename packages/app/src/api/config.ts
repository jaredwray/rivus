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

/**
 * The Google Maps Platform key used for address autocomplete, or `null` when
 * unset (the address field then degrades to a plain text input). This key is
 * inlined into the client bundle, so it must be HTTP-referrer + API restricted
 * in the Google Cloud console.
 */
export function getGoogleMapsApiKey(
	env: Record<string, string | undefined> = process.env,
): string | null {
	const key = env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
	return key && key.length > 0 ? key : null;
}

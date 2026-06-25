/**
 * Resolve the base URL of the Rivus API.
 *
 * `EXPO_PUBLIC_*` vars are inlined by the Expo bundler and are therefore safe to
 * read on the client. We fall back to the local API dev server so the app is
 * runnable out of the box.
 */
export const DEFAULT_API_URL = 'http://localhost:4000';

/**
 * The build-time values of the `EXPO_PUBLIC_*` vars we read.
 *
 * Expo/Metro inlines these only where `process.env.EXPO_PUBLIC_*` appears as a
 * **literal** member expression in source. Reading them indirectly (e.g. via a
 * variable that holds `process.env`, as this used to) defeats the static
 * replacement, so the value is `undefined` in the bundle and the address field
 * silently degrades to a plain text input. Reference each var directly here so
 * the bundler can substitute it; the accessors keep an injectable `env`
 * parameter for hermetic tests. `process` and `process.env` are both guarded:
 * in some React Native / Expo (or edge) JS engines `process` may be undefined,
 * or shimmed as an object whose `env` is undefined, either of which would crash
 * a direct property read.
 */
function ambientEnv(): Record<string, string | undefined> {
	if (typeof process === 'undefined' || typeof process.env === 'undefined') {
		return {};
	}
	return {
		EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
		EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
	};
}

export function getApiBaseUrl(env: Record<string, string | undefined> = ambientEnv()): string {
	const fromEnv = env.EXPO_PUBLIC_API_URL?.trim();
	return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_API_URL;
}

/**
 * The Google Maps Platform key used for address autocomplete, or `null` when
 * unset (the address field then degrades to a plain text input). This key is
 * inlined into the client bundle, so it must be HTTP-referrer + API restricted
 * in the Google Cloud console. Because that referrer restriction only authorizes
 * web origins, callers gate autocomplete to web (see `AuthScreen`); native
 * builds carry no referer and would be rejected.
 */
export function getGoogleMapsApiKey(
	env: Record<string, string | undefined> = ambientEnv(),
): string | null {
	const key = env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
	return key && key.length > 0 ? key : null;
}

/**
 * IANA timezone helpers for the signup form's timezone dropdown.
 *
 * Pure and runtime-agnostic so they're unit-tested under Node. The browser
 * (react-native-web) and modern Hermes expose `Intl.supportedValuesOf`; older
 * engines don't, so we fall back to a curated list rather than throwing.
 */

/** A sensible fallback when the runtime can't enumerate timezones. */
export const FALLBACK_TIMEZONES = [
	'UTC',
	'America/Anchorage',
	'America/Los_Angeles',
	'America/Denver',
	'America/Chicago',
	'America/New_York',
	'America/Toronto',
	'America/Sao_Paulo',
	'Europe/London',
	'Europe/Paris',
	'Europe/Berlin',
	'Europe/Madrid',
	'Africa/Johannesburg',
	'Asia/Dubai',
	'Asia/Kolkata',
	'Asia/Shanghai',
	'Asia/Tokyo',
	'Australia/Sydney',
	'Pacific/Auckland',
	'Pacific/Honolulu',
];

type IntlWithSupportedValues = typeof Intl & {
	supportedValuesOf?: (key: string) => string[];
};

/**
 * Every IANA timezone the runtime knows, or the curated fallback list. `UTC` is
 * always first so the API's default timezone is selectable even though
 * `Intl.supportedValuesOf` lists it only as `Etc/UTC`.
 */
export function listTimezones(intl: typeof Intl = Intl): string[] {
	const supportedValuesOf = (intl as IntlWithSupportedValues).supportedValuesOf;
	if (typeof supportedValuesOf === 'function') {
		try {
			const zones = supportedValuesOf('timeZone');
			if (zones.length > 0) {
				return zones.includes('UTC') ? zones : ['UTC', ...zones];
			}
		} catch {
			// Fall through to the curated list.
		}
	}
	return FALLBACK_TIMEZONES;
}

/** The device's current IANA timezone, falling back to `fallback` if unavailable. */
export function deviceTimezone(fallback = 'UTC', intl: typeof Intl = Intl): string {
	try {
		return new intl.DateTimeFormat().resolvedOptions().timeZone || fallback;
	} catch {
		return fallback;
	}
}

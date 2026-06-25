import { describe, expect, it } from 'vitest';
import {
	buildInviteAcceptUrl,
	DEFAULT_API_URL,
	DEFAULT_APP_URL,
	getApiBaseUrl,
	getAppBaseUrl,
	getGoogleMapsApiKey,
} from './config';

/** Temporarily install a fake `window` (the test runner is Node, where it's absent). */
function withWindow<T>(origin: string | undefined, run: () => T): T {
	const holder = globalThis as { window?: unknown };
	const had = 'window' in holder;
	const original = holder.window;
	holder.window = origin === undefined ? {} : { location: { origin } };
	try {
		return run();
	} finally {
		if (had) {
			holder.window = original;
		} else {
			delete holder.window;
		}
	}
}

describe('getApiBaseUrl', () => {
	it('returns the configured EXPO_PUBLIC_API_URL when set', () => {
		expect(getApiBaseUrl({ EXPO_PUBLIC_API_URL: 'https://api.rivus.dev' })).toBe(
			'https://api.rivus.dev',
		);
	});

	it('trims surrounding whitespace from the configured URL', () => {
		expect(getApiBaseUrl({ EXPO_PUBLIC_API_URL: '  https://api.rivus.dev  ' })).toBe(
			'https://api.rivus.dev',
		);
	});

	it('falls back to the default when the var is missing', () => {
		expect(getApiBaseUrl({})).toBe(DEFAULT_API_URL);
	});

	it('falls back to the default when the var is blank', () => {
		expect(getApiBaseUrl({ EXPO_PUBLIC_API_URL: '   ' })).toBe(DEFAULT_API_URL);
	});

	it('reads from process.env by default', () => {
		// No throw, returns a string regardless of ambient env.
		expect(typeof getApiBaseUrl()).toBe('string');
	});
});

describe('getGoogleMapsApiKey', () => {
	it('returns the key when set', () => {
		expect(getGoogleMapsApiKey({ EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: 'AIza-test' })).toBe('AIza-test');
	});

	it('trims surrounding whitespace', () => {
		expect(getGoogleMapsApiKey({ EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: '  AIza-test  ' })).toBe(
			'AIza-test',
		);
	});

	it('returns null when unset or blank', () => {
		expect(getGoogleMapsApiKey({})).toBeNull();
		expect(getGoogleMapsApiKey({ EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: '   ' })).toBeNull();
	});

	it('reads from process.env by default without throwing', () => {
		const key = getGoogleMapsApiKey();
		expect(key === null || typeof key === 'string').toBe(true);
	});
});

describe('getAppBaseUrl', () => {
	it('returns the configured EXPO_PUBLIC_APP_URL when set', () => {
		expect(getAppBaseUrl({ EXPO_PUBLIC_APP_URL: 'https://team.rivus.test' })).toBe(
			'https://team.rivus.test',
		);
	});

	it('trims whitespace and trailing slashes from the configured URL', () => {
		expect(getAppBaseUrl({ EXPO_PUBLIC_APP_URL: '  https://team.rivus.test/  ' })).toBe(
			'https://team.rivus.test',
		);
	});

	it('falls back to the browser origin on web when no var is set', () => {
		withWindow('https://app.example.com', () => {
			expect(getAppBaseUrl({})).toBe('https://app.example.com');
		});
	});

	it('falls back to the default when there is no var and no browser origin', () => {
		// Node has no `window`; this exercises the native / non-browser path.
		expect(getAppBaseUrl({})).toBe(DEFAULT_APP_URL);
		// A `window` without a usable origin also degrades to the default.
		withWindow(undefined, () => {
			expect(getAppBaseUrl({})).toBe(DEFAULT_APP_URL);
		});
	});

	it('reads from process.env by default without throwing', () => {
		expect(typeof getAppBaseUrl()).toBe('string');
	});
});

describe('buildInviteAcceptUrl', () => {
	it('embeds the token in the accept-invite query', () => {
		expect(buildInviteAcceptUrl('abc123', 'https://app.rivus.ai')).toBe(
			'https://app.rivus.ai/accept-invite?token=abc123',
		);
	});

	it('url-encodes tokens containing unsafe characters', () => {
		expect(buildInviteAcceptUrl('a b/c?d', 'https://app.rivus.ai')).toBe(
			'https://app.rivus.ai/accept-invite?token=a%20b%2Fc%3Fd',
		);
	});

	it('trims a trailing slash from the base before appending', () => {
		expect(buildInviteAcceptUrl('abc', 'https://app.rivus.ai/')).toBe(
			'https://app.rivus.ai/accept-invite?token=abc',
		);
	});

	it('defaults the base to the resolved app URL', () => {
		// No base argument → resolves via getAppBaseUrl(); the path/token are stable
		// regardless of which base wins, so assert on the suffix.
		expect(buildInviteAcceptUrl('abc').endsWith('/accept-invite?token=abc')).toBe(true);
	});
});

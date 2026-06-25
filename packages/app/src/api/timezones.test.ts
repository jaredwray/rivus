import { describe, expect, it } from 'vitest';
import { deviceTimezone, FALLBACK_TIMEZONES, listTimezones } from './timezones';

describe('listTimezones', () => {
	it('returns the runtime list when Intl.supportedValuesOf is available', () => {
		const zones = listTimezones();
		expect(zones.length).toBeGreaterThan(0);
		expect(zones).toContain('UTC');
	});

	it('falls back to the curated list when supportedValuesOf is missing', () => {
		const fakeIntl = {} as typeof Intl;
		expect(listTimezones(fakeIntl)).toBe(FALLBACK_TIMEZONES);
	});

	it('falls back when supportedValuesOf throws', () => {
		const fakeIntl = {
			supportedValuesOf: () => {
				throw new Error('not supported');
			},
		} as unknown as typeof Intl;
		expect(listTimezones(fakeIntl)).toBe(FALLBACK_TIMEZONES);
	});

	it('falls back when supportedValuesOf returns an empty list', () => {
		const fakeIntl = { supportedValuesOf: () => [] } as unknown as typeof Intl;
		expect(listTimezones(fakeIntl)).toBe(FALLBACK_TIMEZONES);
	});
});

describe('deviceTimezone', () => {
	it('returns a non-empty IANA timezone from the runtime', () => {
		expect(deviceTimezone()).toMatch(/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)*$/);
	});

	it('returns the fallback when resolving throws', () => {
		const fakeIntl = {
			DateTimeFormat: class {
				resolvedOptions(): { timeZone: string } {
					throw new Error('no Intl');
				}
			},
		} as unknown as typeof Intl;
		expect(deviceTimezone('UTC', fakeIntl)).toBe('UTC');
	});

	it('returns the fallback when the resolved timezone is empty', () => {
		const fakeIntl = {
			DateTimeFormat: class {
				resolvedOptions(): { timeZone: string } {
					return { timeZone: '' };
				}
			},
		} as unknown as typeof Intl;
		expect(deviceTimezone('America/New_York', fakeIntl)).toBe('America/New_York');
	});
});

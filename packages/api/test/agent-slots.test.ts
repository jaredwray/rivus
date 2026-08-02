import { describe, expect, it } from 'vitest';
import {
	BUSINESS_END_HOUR,
	BUSINESS_START_HOUR,
	computeOpenSlots,
	computeOpenSlotsOnDay,
	formatDayLabel,
	formatSlotLabel,
	instantForZonedTime,
	isSlotFree,
	isWithinBusinessHours,
	MIN_NOTICE_MINUTES,
	OFFER_COUNT,
	SEARCH_WINDOW_DAYS,
	safeTimeZone,
	zonedParts,
} from '../src/services/agent/slots';

const PACIFIC = 'America/Los_Angeles';
// Wednesday July 1st 2026, 10:00 AM PDT.
const NOW = new Date('2026-07-01T17:00:00.000Z');

describe('safeTimeZone', () => {
	it('keeps a valid IANA zone', () => {
		expect(safeTimeZone(PACIFIC)).toBe(PACIFIC);
	});

	it('falls back to UTC for free-text junk (account timezones are unvalidated)', () => {
		expect(safeTimeZone('Pacific Time')).toBe('UTC');
		expect(safeTimeZone('')).toBe('UTC');
	});
});

describe('zonedParts / instantForZonedTime', () => {
	it('round-trips a wall-clock time through a zone', () => {
		const instant = instantForZonedTime(PACIFIC, {
			year: 2026,
			month: 7,
			day: 7,
			hour: 14,
			minute: 30,
		});
		// 2:30 PM PDT = 21:30 UTC.
		expect(instant.toISOString()).toBe('2026-07-07T21:30:00.000Z');
		expect(zonedParts(instant, PACIFIC)).toEqual({
			year: 2026,
			month: 7,
			day: 7,
			hour: 14,
			minute: 30,
			weekday: 2,
		});
	});

	it('handles a zone with no DST (UTC) as identity', () => {
		const instant = instantForZonedTime('UTC', {
			year: 2026,
			month: 1,
			day: 5,
			hour: 9,
			minute: 0,
		});
		expect(instant.toISOString()).toBe('2026-01-05T09:00:00.000Z');
	});

	it('resolves a spring-forward gap time without crashing', () => {
		// 2:30 AM on 2026-03-08 does not exist in New York (clocks jump 2→3).
		const instant = instantForZonedTime('America/New_York', {
			year: 2026,
			month: 3,
			day: 8,
			hour: 2,
			minute: 30,
		});
		// The instant lands on that calendar day, shifted by the gap.
		const parts = zonedParts(instant, 'America/New_York');
		expect(parts.year).toBe(2026);
		expect(parts.month).toBe(3);
		expect(parts.day).toBe(8);
	});
});

describe('isSlotFree', () => {
	const slot = { startAt: '2026-07-07T17:00:00.000Z', durationMinutes: 60 };

	it('is free when nothing is booked', () => {
		expect(isSlotFree(slot, [])).toBe(true);
	});

	it('is busy when a booking overlaps the middle', () => {
		expect(isSlotFree(slot, [{ startAt: '2026-07-07T17:30:00.000Z', durationMinutes: 60 }])).toBe(
			false,
		);
	});

	it('is busy when a booking fully covers it', () => {
		expect(isSlotFree(slot, [{ startAt: '2026-07-07T16:00:00.000Z', durationMinutes: 240 }])).toBe(
			false,
		);
	});

	it('treats [start, end) as half-open: back-to-back bookings do not collide', () => {
		// Ends exactly when the slot starts…
		expect(isSlotFree(slot, [{ startAt: '2026-07-07T16:00:00.000Z', durationMinutes: 60 }])).toBe(
			true,
		);
		// …and starts exactly when the slot ends.
		expect(isSlotFree(slot, [{ startAt: '2026-07-07T18:00:00.000Z', durationMinutes: 60 }])).toBe(
			true,
		);
	});
});

describe('isWithinBusinessHours', () => {
	it('accepts a weekday morning inside 9–5', () => {
		// Tuesday 9:00 AM PDT.
		expect(isWithinBusinessHours('2026-07-07T16:00:00.000Z', 60, PACIFIC)).toBe(true);
	});

	it('accepts the last slot that still ends at close', () => {
		// Tuesday 4:00 PM PDT + 60min ends exactly at 5 PM.
		expect(isWithinBusinessHours('2026-07-07T23:00:00.000Z', 60, PACIFIC)).toBe(true);
	});

	it('rejects a start before opening or an end past close', () => {
		// Tuesday 8:00 AM PDT.
		expect(isWithinBusinessHours('2026-07-07T15:00:00.000Z', 60, PACIFIC)).toBe(false);
		// Tuesday 4:30 PM PDT + 60min would end 5:30 PM.
		expect(isWithinBusinessHours('2026-07-07T23:30:00.000Z', 60, PACIFIC)).toBe(false);
	});

	it('rejects weekends', () => {
		// Saturday July 4th 2026, 10:00 AM PDT.
		expect(isWithinBusinessHours('2026-07-04T17:00:00.000Z', 60, PACIFIC)).toBe(false);
		// Sunday July 5th.
		expect(isWithinBusinessHours('2026-07-05T17:00:00.000Z', 60, PACIFIC)).toBe(false);
	});
});

describe('computeOpenSlots', () => {
	it('offers slots on distinct weekdays, all within business hours and past the notice window', () => {
		const slots = computeOpenSlots({ now: NOW, timeZone: PACIFIC, busy: [] });
		expect(slots).toHaveLength(OFFER_COUNT);
		const days = new Set<string>();
		for (const slot of slots) {
			const parts = zonedParts(new Date(slot.startAt), PACIFIC);
			expect(parts.weekday).toBeGreaterThanOrEqual(1);
			expect(parts.weekday).toBeLessThanOrEqual(5);
			expect(parts.hour).toBeGreaterThanOrEqual(BUSINESS_START_HOUR);
			expect(parts.hour + 1).toBeLessThanOrEqual(BUSINESS_END_HOUR);
			expect(Date.parse(slot.startAt)).toBeGreaterThanOrEqual(
				NOW.getTime() + MIN_NOTICE_MINUTES * 60_000,
			);
			days.add(`${parts.year}-${parts.month}-${parts.day}`);
		}
		expect(days.size).toBe(OFFER_COUNT);
		// Chronological.
		expect([...slots].map((slot) => slot.startAt)).toEqual(
			[...slots].map((slot) => slot.startAt).sort(),
		);
	});

	it('starts at the earliest bookable hour a day allows', () => {
		const slots = computeOpenSlots({ now: NOW, timeZone: PACIFIC, busy: [] });
		// Now is Wednesday 10 AM PDT; 24h notice makes Thursday 10 AM the earliest,
		// so the first offer is Thursday July 2nd at 10:00 AM PDT.
		expect(slots[0]?.startAt).toBe('2026-07-02T17:00:00.000Z');
	});

	it('skips hours already booked', () => {
		const slots = computeOpenSlots({
			now: NOW,
			timeZone: PACIFIC,
			// Book Thursday 10 AM PDT solid (the would-be first offer).
			busy: [{ startAt: '2026-07-02T17:00:00.000Z', durationMinutes: 60 }],
		});
		expect(slots[0]?.startAt).toBe('2026-07-02T18:00:00.000Z');
	});

	it('returns nothing when the whole window is booked', () => {
		// One giant block covering the entire search window.
		const slots = computeOpenSlots({
			now: NOW,
			timeZone: PACIFIC,
			busy: [
				{
					startAt: NOW.toISOString(),
					durationMinutes: (SEARCH_WINDOW_DAYS + 2) * 24 * 60,
				},
			],
		});
		expect(slots).toEqual([]);
	});

	it('tops up from the same day when only one day has openings', () => {
		// Block every day except Thursday July 2nd (leave 10 AM – 5 PM open there).
		const busy = [
			{ startAt: '2026-07-03T00:00:00.000Z', durationMinutes: SEARCH_WINDOW_DAYS * 24 * 60 },
		];
		const slots = computeOpenSlots({ now: NOW, timeZone: PACIFIC, busy });
		expect(slots).toHaveLength(OFFER_COUNT);
		expect(slots.map((slot) => slot.startAt)).toEqual([
			'2026-07-02T17:00:00.000Z',
			'2026-07-02T18:00:00.000Z',
			'2026-07-02T19:00:00.000Z',
		]);
	});

	it('never offers a weekend even when the notice window lands on one', () => {
		// Friday July 3rd 2026, 10 AM PDT — 24h notice lands on Saturday.
		const friday = new Date('2026-07-03T17:00:00.000Z');
		const slots = computeOpenSlots({ now: friday, timeZone: PACIFIC, busy: [] });
		const first = zonedParts(new Date(slots[0]?.startAt ?? ''), PACIFIC);
		// First offer is Monday July 6th.
		expect(first.weekday).toBe(1);
		expect(first.day).toBe(6);
	});

	it('respects the account timezone (same wall clock, different instants)', () => {
		const pacific = computeOpenSlots({ now: NOW, timeZone: PACIFIC, busy: [] });
		const utc = computeOpenSlots({ now: NOW, timeZone: 'UTC', busy: [] });
		const pacificParts = zonedParts(new Date(pacific[0]?.startAt ?? ''), PACIFIC);
		const utcParts = zonedParts(new Date(utc[0]?.startAt ?? ''), 'UTC');
		// Both are business-hour starts on their own wall clocks…
		expect(pacificParts.hour).toBeGreaterThanOrEqual(BUSINESS_START_HOUR);
		expect(utcParts.hour).toBeGreaterThanOrEqual(BUSINESS_START_HOUR);
		// …but the underlying instants differ.
		expect(pacific[0]?.startAt).not.toBe(utc[0]?.startAt);
	});

	it('returns nothing for a non-positive count', () => {
		expect(computeOpenSlots({ now: NOW, timeZone: PACIFIC, busy: [], count: 0 })).toEqual([]);
	});
});

describe('computeOpenSlotsOnDay', () => {
	// Tuesday July 7th 2026 — a weekday well past the 24-hour notice window.
	const TUESDAY = { year: 2026, month: 7, day: 7 };

	function onDay(overrides: Partial<Parameters<typeof computeOpenSlotsOnDay>[0]> = {}) {
		return computeOpenSlotsOnDay({
			now: NOW,
			timeZone: PACIFIC,
			busy: [],
			day: TUESDAY,
			...overrides,
		});
	}

	it('spreads its offers across a free day instead of taking the first hours', () => {
		// 9 AM, 1 PM and 4 PM Pacific — a morning/midday/afternoon choice, not 9-10-11.
		expect(onDay().map((slot) => slot.startAt)).toEqual([
			'2026-07-07T16:00:00.000Z',
			'2026-07-07T20:00:00.000Z',
			'2026-07-07T23:00:00.000Z',
		]);
		expect(onDay()).toHaveLength(OFFER_COUNT);
	});

	it('stays on the requested day, inside business hours', () => {
		for (const slot of onDay()) {
			const parts = zonedParts(new Date(slot.startAt), PACIFIC);
			expect({ year: parts.year, month: parts.month, day: parts.day }).toEqual(TUESDAY);
			expect(parts.hour).toBeGreaterThanOrEqual(BUSINESS_START_HOUR);
			expect(parts.hour + 1).toBeLessThanOrEqual(BUSINESS_END_HOUR);
		}
	});

	it('skips hours that collide with a booking', () => {
		const busy = [
			// 9 AM and 1 PM Pacific — the two hours the free-day spread would pick.
			{ startAt: '2026-07-07T16:00:00.000Z', durationMinutes: 60 },
			{ startAt: '2026-07-07T20:00:00.000Z', durationMinutes: 60 },
		];
		const slots = onDay({ busy });
		expect(slots).toHaveLength(OFFER_COUNT);
		expect(slots.map((slot) => slot.startAt)).not.toContain('2026-07-07T16:00:00.000Z');
		expect(slots.map((slot) => slot.startAt)).not.toContain('2026-07-07T20:00:00.000Z');
	});

	it('returns nothing when the day is booked solid', () => {
		// Midnight to midnight, Pacific.
		const busy = [{ startAt: '2026-07-07T07:00:00.000Z', durationMinutes: 24 * 60 }];
		expect(onDay({ busy })).toEqual([]);
	});

	it('returns nothing when the whole day sits inside the notice window', () => {
		// Asked at 5 PM Pacific on the 1st about tomorrow: 24 hours' notice lands
		// after the last bookable hour on the 2nd.
		const lateAfternoon = new Date('2026-07-02T00:00:00.000Z');
		expect(onDay({ now: lateAfternoon, day: { year: 2026, month: 7, day: 2 } })).toEqual([]);
	});

	it('returns nothing for a weekend day', () => {
		// Saturday July 4th and Sunday the 5th.
		expect(onDay({ day: { year: 2026, month: 7, day: 4 } })).toEqual([]);
		expect(onDay({ day: { year: 2026, month: 7, day: 5 } })).toEqual([]);
	});

	it('returns everything that is open when fewer slots exist than asked for', () => {
		// Only the 9 AM and 10 AM hours survive.
		const busy = [{ startAt: '2026-07-07T18:00:00.000Z', durationMinutes: 8 * 60 }];
		expect(onDay({ busy }).map((slot) => slot.startAt)).toEqual([
			'2026-07-07T16:00:00.000Z',
			'2026-07-07T17:00:00.000Z',
		]);
	});

	it('takes the earliest opening for a single-slot count, and nothing for a zero count', () => {
		expect(onDay({ count: 1 }).map((slot) => slot.startAt)).toEqual(['2026-07-07T16:00:00.000Z']);
		expect(onDay({ count: 0 })).toEqual([]);
	});

	it('honors a custom duration when deciding what still fits before close', () => {
		const slots = onDay({ durationMinutes: 120, count: 8 });
		// A two-hour job can start at 9 through 3 PM (ending at 5), so seven starts.
		expect(slots).toHaveLength(7);
		expect(slots.at(-1)?.startAt).toBe('2026-07-07T22:00:00.000Z');
	});
});

describe('formatDayLabel', () => {
	it('reads as a human day in the account zone', () => {
		// Midnight Pacific on Tuesday July 7th.
		expect(formatDayLabel('2026-07-07T07:00:00.000Z', PACIFIC)).toBe('Tuesday, July 7');
	});

	it('adds the year only when the day falls outside the current year', () => {
		// Midnight Pacific on Friday January 1st 2027.
		expect(formatDayLabel('2027-01-01T08:00:00.000Z', PACIFIC, 2026)).toBe(
			'Friday, January 1, 2027',
		);
		expect(formatDayLabel('2026-07-07T07:00:00.000Z', PACIFIC, 2026)).toBe('Tuesday, July 7');
	});
});

describe('formatSlotLabel', () => {
	it('reads as a human day + time in the account zone', () => {
		expect(formatSlotLabel('2026-07-07T16:00:00.000Z', PACIFIC)).toBe('Tuesday, July 7 at 9:00 AM');
	});

	it('formats afternoons with minutes', () => {
		expect(formatSlotLabel('2026-07-07T21:30:00.000Z', PACIFIC)).toBe('Tuesday, July 7 at 2:30 PM');
	});
});

describe('formatSlotLabel — year disambiguation', () => {
	it('adds the year only when the slot falls outside the current year', () => {
		expect(formatSlotLabel('2027-01-04T17:00:00.000Z', PACIFIC, 2026)).toBe(
			'Monday, January 4, 2027 at 9:00 AM',
		);
		expect(formatSlotLabel('2026-07-07T16:00:00.000Z', PACIFIC, 2026)).toBe(
			'Tuesday, July 7 at 9:00 AM',
		);
	});
});

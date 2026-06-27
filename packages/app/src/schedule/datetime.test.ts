import { describe, expect, it } from 'vitest';
import {
	dateFromKeyAndMinutes,
	dayRange,
	formatHourLabel,
	formatRangeLabel,
	formatTimeLabel,
	GRID_START_HOUR,
	HOUR_HEIGHT,
	isoFromKeyAndMinutes,
	isValidDateKey,
	minutesSinceMidnight,
	placeEvent,
	startOfWeek,
	weekDays,
	weekRange,
} from './datetime';

describe('formatTimeLabel', () => {
	it('formats minutes-of-day on a 12-hour clock', () => {
		expect(formatTimeLabel(0)).toBe('12:00 AM');
		expect(formatTimeLabel(570)).toBe('9:30 AM');
		expect(formatTimeLabel(720)).toBe('12:00 PM');
		expect(formatTimeLabel(780)).toBe('1:00 PM');
		expect(formatTimeLabel(1439)).toBe('11:59 PM');
	});
});

describe('formatHourLabel', () => {
	it('labels whole hours', () => {
		expect(formatHourLabel(0)).toBe('12 AM');
		expect(formatHourLabel(7)).toBe('7 AM');
		expect(formatHourLabel(12)).toBe('12 PM');
		expect(formatHourLabel(19)).toBe('7 PM');
	});
});

describe('isValidDateKey', () => {
	it('accepts real calendar dates and rejects impossible ones', () => {
		expect(isValidDateKey('2026-06-24')).toBe(true);
		expect(isValidDateKey('2026-02-30')).toBe(false);
		expect(isValidDateKey('2026-13-01')).toBe(false);
		expect(isValidDateKey('06/24/2026')).toBe(false);
		expect(isValidDateKey('nope')).toBe(false);
	});
});

describe('startOfWeek / weekDays', () => {
	it('anchors the week on Monday', () => {
		// 2026-06-24 is a Wednesday.
		const anchor = new Date(2026, 5, 24);
		const monday = startOfWeek(anchor);
		expect(monday.getDay()).toBe(1);
		expect(monday.getDate()).toBe(22);
	});

	it('produces seven Monday-first cells and flags today', () => {
		const anchor = new Date(2026, 5, 24);
		const cells = weekDays(anchor, anchor);
		expect(cells).toHaveLength(7);
		expect(cells[0].dow).toBe('MON');
		expect(cells[6].dow).toBe('SUN');
		expect(cells.find((c) => c.isToday)?.dayNum).toBe(24);
	});
});

describe('placeEvent', () => {
	it('places an event by its local start and scales height by duration', () => {
		// 9:00 AM local on the grid that starts at GRID_START_HOUR.
		const startAt = isoFromKeyAndMinutes('2026-06-24', 9 * 60);
		const { top, height } = placeEvent(startAt, 60);
		expect(top).toBe(((9 * 60 - GRID_START_HOUR * 60) / 60) * HOUR_HEIGHT);
		expect(height).toBe(HOUR_HEIGHT);
	});

	it('never renders shorter than the minimum tappable height', () => {
		const startAt = isoFromKeyAndMinutes('2026-06-24', 9 * 60);
		expect(placeEvent(startAt, 5).height).toBeGreaterThanOrEqual(22);
	});
});

describe('isoFromKeyAndMinutes / round-trip', () => {
	it('round-trips a local day-key + minutes back to the same wall-clock time', () => {
		const iso = isoFromKeyAndMinutes('2026-06-24', 9 * 60 + 30);
		expect(minutesSinceMidnight(new Date(iso))).toBe(9 * 60 + 30);
		expect(dateFromKeyAndMinutes('2026-06-24', 0).getHours()).toBe(0);
	});
});

describe('weekRange / dayRange', () => {
	it('returns a half-open week window', () => {
		const { from, to } = weekRange(new Date(2026, 5, 24));
		expect(Date.parse(from)).toBeLessThan(Date.parse(to));
		expect(Date.parse(to) - Date.parse(from)).toBe(7 * 86_400_000);
	});

	it('returns a one-day window', () => {
		const { from, to } = dayRange(new Date(2026, 5, 24));
		expect(Date.parse(to) - Date.parse(from)).toBe(86_400_000);
	});
});

describe('formatRangeLabel', () => {
	it('collapses a same-month range and spells out a cross-month one', () => {
		expect(formatRangeLabel(new Date(2026, 5, 22), new Date(2026, 5, 28))).toBe('Jun 22 – 28');
		expect(formatRangeLabel(new Date(2026, 5, 29), new Date(2026, 6, 5))).toBe('Jun 29 – Jul 5');
	});
});

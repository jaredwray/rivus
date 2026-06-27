// Pure date/calendar helpers for the schedule screen. No React/RN imports, so the
// math stays unit-testable.
//
// Times are interpreted in the *device's* local zone: a job's `startAt` (a UTC
// instant) is rendered and edited using local `getHours()`/`setHours()`, which is
// correct when the operator's device runs in the business's time zone — the common
// case for a single-location home-services business. Rendering in the account's
// IANA zone regardless of device is a deliberate follow-up.

// The grid spans these hours (24h), one row per hour. They match `timeOptions`'
// default window (6 AM–8 PM) so every selectable start time is visible on the
// grid — a job booked at the earliest/latest slot is never clipped by the
// day column's `overflow: hidden`.
export const GRID_START_HOUR = 6;
export const GRID_END_HOUR = 20;
/** Pixel height of one hour row in the week/day grid. */
export const HOUR_HEIGHT = 56;
/** Minimum rendered height of an event so very short jobs stay tappable. */
const MIN_EVENT_HEIGHT = 22;

const DOW_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
const MONTH_LABELS = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec',
] as const;

/** Local midnight at the start of `date`'s day. */
export function startOfDay(date: Date): Date {
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	return d;
}

/** Local midnight of the Monday on or before `date` (weeks start Monday). */
export function startOfWeek(date: Date): Date {
	const d = startOfDay(date);
	// getDay(): 0=Sun..6=Sat → days since Monday.
	const sinceMonday = (d.getDay() + 6) % 7;
	d.setDate(d.getDate() - sinceMonday);
	return d;
}

export function addDays(date: Date, days: number): Date {
	const d = new Date(date);
	d.setDate(d.getDate() + days);
	return d;
}

/** A local-calendar key like `2026-06-24` (no time, no zone shift). */
export function localDateKey(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

/** Whether `key` is a real `YYYY-MM-DD` calendar date (rejects `2026-02-30`). */
export function isValidDateKey(key: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
		return false;
	}
	const [year, month, day] = key.split('-').map(Number);
	const date = new Date(year, month - 1, day);
	return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/** Minutes since local midnight (e.g. 9:30 AM → 570). */
export function minutesSinceMidnight(date: Date): number {
	return date.getHours() * 60 + date.getMinutes();
}

/** Build a local Date from a `YYYY-MM-DD` key and minutes-since-midnight. */
export function dateFromKeyAndMinutes(key: string, minutes: number): Date {
	const [year, month, day] = key.split('-').map(Number);
	return new Date(year, month - 1, day, Math.floor(minutes / 60), minutes % 60, 0, 0);
}

/** The UTC instant (ISO string) for a local day-key + minutes-of-day. */
export function isoFromKeyAndMinutes(key: string, minutes: number): string {
	return dateFromKeyAndMinutes(key, minutes).toISOString();
}

/** `[from, to)` covering the local week containing `anchor`, as ISO instants. */
export function weekRange(anchor: Date): { from: string; to: string } {
	const start = startOfWeek(anchor);
	return { from: start.toISOString(), to: addDays(start, 7).toISOString() };
}

/** `[from, to)` covering the local day of `date`, as ISO instants. */
export function dayRange(date: Date): { from: string; to: string } {
	const start = startOfDay(date);
	return { from: start.toISOString(), to: addDays(start, 1).toISOString() };
}

/** 12-hour clock label for minutes-of-day, e.g. 570 → "9:30 AM". */
export function formatTimeLabel(minutes: number): string {
	const hour24 = Math.floor(minutes / 60);
	const minute = minutes % 60;
	const period = hour24 < 12 ? 'AM' : 'PM';
	const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
	return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}

/** Whole-hour label, e.g. 13 → "1 PM". */
export function formatHourLabel(hour: number): string {
	const period = hour < 12 ? 'AM' : 'PM';
	const hour12 = hour % 12 === 0 ? 12 : hour % 12;
	return `${hour12} ${period}`;
}

/** Clock time of a job's start, e.g. "9:30 AM". */
export function formatClock(startAt: string): string {
	return formatTimeLabel(minutesSinceMidnight(new Date(startAt)));
}

/** Friendly week/day range label, e.g. "Jun 22 – 28" or "Jun 29 – Jul 5". */
export function formatRangeLabel(start: Date, endInclusive: Date): string {
	const startLabel = `${MONTH_LABELS[start.getMonth()]} ${start.getDate()}`;
	if (start.getMonth() === endInclusive.getMonth()) {
		return `${startLabel} – ${endInclusive.getDate()}`;
	}
	return `${startLabel} – ${MONTH_LABELS[endInclusive.getMonth()]} ${endInclusive.getDate()}`;
}

/** Long single-day label, e.g. "Wednesday, Jun 24". */
export function formatDayLabel(date: Date): string {
	const longDow = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
		date.getDay()
	];
	return `${longDow}, ${MONTH_LABELS[date.getMonth()]} ${date.getDate()}`;
}

export interface DayCell {
	date: Date;
	key: string;
	dow: string;
	dayNum: number;
	isToday: boolean;
}

/** The seven Monday-anchored day cells for the week containing `anchor`. */
export function weekDays(anchor: Date, today: Date): DayCell[] {
	const start = startOfWeek(anchor);
	const todayKey = localDateKey(today);
	return Array.from({ length: 7 }, (_unused, index) => {
		const date = addDays(start, index);
		const key = localDateKey(date);
		return {
			date,
			key,
			dow: DOW_LABELS[date.getDay()],
			dayNum: date.getDate(),
			isToday: key === todayKey,
		};
	});
}

export interface Placement {
	top: number;
	height: number;
}

/** Pixel offset/height of an event within a day column, relative to the grid top. */
export function placeEvent(startAt: string, durationMinutes: number): Placement {
	const minutes = minutesSinceMidnight(new Date(startAt));
	const top = ((minutes - GRID_START_HOUR * 60) / 60) * HOUR_HEIGHT;
	const height = Math.max(MIN_EVENT_HEIGHT, (durationMinutes / 60) * HOUR_HEIGHT);
	return { top, height };
}

/** The hour labels down the grid gutter (`GRID_START_HOUR`..`GRID_END_HOUR`). */
export function gridHours(): number[] {
	const hours: number[] = [];
	for (let hour = GRID_START_HOUR; hour <= GRID_END_HOUR; hour += 1) {
		hours.push(hour);
	}
	return hours;
}

export interface LanePlacement {
	/** 0-based column this event sits in within its overlap cluster. */
	lane: number;
	/** Number of side-by-side columns the event's cluster needs. */
	columns: number;
}

/**
 * Pack a day's events into side-by-side lanes so overlapping jobs (the API allows
 * double-booking) render next to each other instead of on top of one another.
 *
 * Events must be sorted by start ascending. Returns a placement parallel to the
 * input: each event's `lane` and the `columns` (max concurrency) of the cluster of
 * transitively-overlapping events it belongs to — so non-overlapping jobs stay
 * full width while only the actually-overlapping ones split.
 */
export function packLanes(events: { startAt: string; durationMinutes: number }[]): LanePlacement[] {
	const startMs = (event: { startAt: string }) => Date.parse(event.startAt);
	const endMs = (event: { startAt: string; durationMinutes: number }) =>
		Date.parse(event.startAt) + event.durationMinutes * 60_000;

	const placements: LanePlacement[] = new Array(events.length);
	let index = 0;
	while (index < events.length) {
		// Grow a cluster of transitively-overlapping events (sorted, so a new event
		// joins while it starts before the cluster's running max end).
		let clusterEnd = endMs(events[index]);
		const members = [index];
		let next = index + 1;
		while (next < events.length && startMs(events[next]) < clusterEnd) {
			clusterEnd = Math.max(clusterEnd, endMs(events[next]));
			members.push(next);
			next += 1;
		}
		// First-fit lane assignment within the cluster.
		const laneEnds: number[] = [];
		for (const member of members) {
			let lane = laneEnds.findIndex((end) => end <= startMs(events[member]));
			if (lane === -1) {
				lane = laneEnds.length;
			}
			laneEnds[lane] = endMs(events[member]);
			placements[member] = { lane, columns: 0 };
		}
		for (const member of members) {
			placements[member].columns = laneEnds.length;
		}
		index = next;
	}
	return placements;
}

export interface Option {
	label: string;
	value: string;
}

/**
 * Selectable start times across the working day, every `stepMinutes`. Defaults to
 * the grid window so every offered start is visible on the calendar (see
 * {@link GRID_START_HOUR}/{@link GRID_END_HOUR}).
 */
export function timeOptions(
	stepMinutes = 30,
	startHour = GRID_START_HOUR,
	endHour = GRID_END_HOUR,
): Option[] {
	const options: Option[] = [];
	for (let minutes = startHour * 60; minutes <= endHour * 60; minutes += stepMinutes) {
		options.push({ label: formatTimeLabel(minutes), value: String(minutes) });
	}
	return options;
}

/** Common job durations, in minutes. */
export const DURATION_OPTIONS: Option[] = [
	{ label: '30 min', value: '30' },
	{ label: '45 min', value: '45' },
	{ label: '1 hour', value: '60' },
	{ label: '1.5 hours', value: '90' },
	{ label: '2 hours', value: '120' },
	{ label: '3 hours', value: '180' },
	{ label: '4 hours', value: '240' },
	{ label: 'All day', value: '480' },
];

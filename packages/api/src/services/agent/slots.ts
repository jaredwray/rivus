import type { AgentSlot, IsoDateString } from '@rivus/core';

/**
 * Pure availability math for the scheduling agent: which appointment windows
 * are open on an account's calendar. Kept free of I/O (the caller fetches the
 * booked jobs) so every boundary — weekends, business hours, timezone edges,
 * a fully booked day — is exhaustively unit-testable.
 */

/** Length of an agent-booked appointment. */
export const SLOT_DURATION_MINUTES = 60;
/** How many openings the agent offers per reply. */
export const OFFER_COUNT = 3;
/** How far ahead the agent looks for openings. */
export const SEARCH_WINDOW_DAYS = 14;
/** Appointments start no earlier than this local hour… */
export const BUSINESS_START_HOUR = 9;
/** …and must end by this local hour (Mon–Fri only). */
export const BUSINESS_END_HOUR = 17;
/** Offers start at least this far in the future, so nobody is booked for "in 5 minutes". */
export const MIN_NOTICE_MINUTES = 24 * 60;
/**
 * The furthest ahead the agent will book a customer-proposed time. Bounds how
 * much calendar the conflict check must load — a proposal past the horizon is
 * declined with an explanation rather than checked against jobs that were
 * never fetched (which would silently double-book).
 */
export const BOOKING_HORIZON_DAYS = 60;

/** A busy window on the calendar (a job's start + duration). */
export interface BusyInterval {
	startAt: IsoDateString;
	durationMinutes: number;
}

/** A wall-clock reading of an instant in some time zone. */
interface ZonedParts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	/** 0 = Sunday … 6 = Saturday. */
	weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
	Sun: 0,
	Mon: 1,
	Tue: 2,
	Wed: 3,
	Thu: 4,
	Fri: 5,
	Sat: 6,
};

// One formatter per zone: Intl.DateTimeFormat construction is expensive and
// slot search reads hundreds of instants per request.
const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
	let formatter = partsFormatters.get(timeZone);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat('en-US', {
			timeZone,
			weekday: 'short',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
		});
		partsFormatters.set(timeZone, formatter);
	}
	return formatter;
}

/**
 * A usable IANA zone: the account's own when valid, otherwise UTC. Account
 * timezones are stored as free text, so an unrecognized value must degrade to
 * a sane calendar rather than crash the webhook.
 */
export function safeTimeZone(timeZone: string): string {
	try {
		formatterFor(timeZone);
		return timeZone;
	} catch {
		return 'UTC';
	}
}

/** Read an instant as wall-clock parts in a zone. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
	const parts: Record<string, string> = {};
	for (const part of formatterFor(timeZone).formatToParts(instant)) {
		parts[part.type] = part.value;
	}
	return {
		year: Number(parts.year),
		month: Number(parts.month),
		day: Number(parts.day),
		// `hour12: false` may render midnight as "24" depending on the ICU version.
		hour: Number(parts.hour) % 24,
		minute: Number(parts.minute),
		weekday: WEEKDAY_INDEX[parts.weekday ?? ''] ?? 0,
	};
}

/** The parts rendered back as a UTC timestamp, for offset arithmetic. */
function wallClockUtcMs(parts: ZonedParts): number {
	return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

/**
 * The UTC instant at which a zone's wall clock reads the given time. Uses the
 * standard two-pass offset correction: guess the instant as if the wall time
 * were UTC, read the guess back in the zone, and shift by the difference
 * (twice, so a DST boundary between guesses still converges). A time that
 * falls inside a spring-forward gap resolves to the shifted clock time.
 */
export function instantForZonedTime(
	timeZone: string,
	wall: { year: number; month: number; day: number; hour: number; minute: number },
): Date {
	const desired = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
	let ts = desired;
	for (let pass = 0; pass < 2; pass += 1) {
		const rendered = wallClockUtcMs(zonedParts(new Date(ts), timeZone));
		const diff = desired - rendered;
		if (diff === 0) {
			break;
		}
		ts += diff;
	}
	return new Date(ts);
}

/** Whether a would-be slot overlaps any busy interval (`[start, end)` semantics). */
export function isSlotFree(slot: AgentSlot, busy: BusyInterval[]): boolean {
	const slotStart = Date.parse(slot.startAt);
	const slotEnd = slotStart + slot.durationMinutes * 60_000;
	return !busy.some((interval) => {
		const busyStart = Date.parse(interval.startAt);
		const busyEnd = busyStart + interval.durationMinutes * 60_000;
		return slotStart < busyEnd && busyStart < slotEnd;
	});
}

/**
 * Whether an instant is a bookable appointment start: a weekday, beginning at
 * or after opening, and ending by close, in the account's zone.
 */
export function isWithinBusinessHours(
	startAt: IsoDateString,
	durationMinutes: number,
	timeZone: string,
): boolean {
	const parts = zonedParts(new Date(startAt), timeZone);
	if (parts.weekday === 0 || parts.weekday === 6) {
		return false;
	}
	const startMinutes = parts.hour * 60 + parts.minute;
	const endMinutes = startMinutes + durationMinutes;
	return startMinutes >= BUSINESS_START_HOUR * 60 && endMinutes <= BUSINESS_END_HOUR * 60;
}

export interface ComputeOpenSlotsOptions {
	/** The current instant — injected so tests are deterministic. */
	now: Date;
	/** IANA zone the business keeps its hours in (pass through {@link safeTimeZone}). */
	timeZone: string;
	/** Already-booked windows (non-canceled jobs) that block a slot. */
	busy: BusyInterval[];
	/** How many openings to return; defaults to {@link OFFER_COUNT}. */
	count?: number;
	/** Slot length; defaults to {@link SLOT_DURATION_MINUTES}. */
	durationMinutes?: number;
}

/**
 * The next open appointment windows: on-the-hour starts within business hours
 * over the coming {@link SEARCH_WINDOW_DAYS}, at least {@link MIN_NOTICE_MINUTES}
 * out, skipping anything that overlaps a busy interval. Offers are spread
 * across distinct days first (a choice of days beats three back-to-back hours),
 * then topped up with the earliest remaining openings.
 */
export function computeOpenSlots(options: ComputeOpenSlotsOptions): AgentSlot[] {
	const count = options.count ?? OFFER_COUNT;
	const durationMinutes = options.durationMinutes ?? SLOT_DURATION_MINUTES;
	if (count <= 0) {
		return [];
	}
	const earliest = options.now.getTime() + MIN_NOTICE_MINUTES * 60_000;
	// Walk local calendar days starting from the earliest bookable instant's
	// local date. Day arithmetic runs on a UTC-normalized (y, m, d) triple so
	// month/year rollover is handled by Date.UTC, not by hand.
	const firstDay = zonedParts(new Date(earliest), options.timeZone);
	const open: Array<{ slot: AgentSlot; dayKey: string }> = [];
	for (let dayOffset = 0; dayOffset < SEARCH_WINDOW_DAYS; dayOffset += 1) {
		const dayCursor = new Date(
			Date.UTC(firstDay.year, firstDay.month - 1, firstDay.day + dayOffset),
		);
		const day = {
			year: dayCursor.getUTCFullYear(),
			month: dayCursor.getUTCMonth() + 1,
			day: dayCursor.getUTCDate(),
		};
		for (
			let hour = BUSINESS_START_HOUR;
			hour * 60 + durationMinutes <= BUSINESS_END_HOUR * 60;
			hour += 1
		) {
			const start = instantForZonedTime(options.timeZone, { ...day, hour, minute: 0 });
			if (start.getTime() < earliest) {
				continue;
			}
			// Weekday is read from the resolved instant (not assumed from the cursor)
			// so zones far from UTC classify the right local day.
			const parts = zonedParts(start, options.timeZone);
			if (parts.weekday === 0 || parts.weekday === 6) {
				continue;
			}
			const slot: AgentSlot = { startAt: start.toISOString(), durationMinutes };
			if (!isSlotFree(slot, options.busy)) {
				continue;
			}
			open.push({ slot, dayKey: `${parts.year}-${parts.month}-${parts.day}` });
		}
	}

	// Spread: first opening of each day until `count` days are represented…
	const picked: AgentSlot[] = [];
	const pickedStarts = new Set<string>();
	const seenDays = new Set<string>();
	for (const entry of open) {
		if (picked.length >= count) {
			break;
		}
		if (seenDays.has(entry.dayKey)) {
			continue;
		}
		seenDays.add(entry.dayKey);
		picked.push(entry.slot);
		pickedStarts.add(entry.slot.startAt);
	}
	// …then top up chronologically when fewer days than `count` had openings.
	for (const entry of open) {
		if (picked.length >= count) {
			break;
		}
		if (!pickedStarts.has(entry.slot.startAt)) {
			picked.push(entry.slot);
			pickedStarts.add(entry.slot.startAt);
		}
	}
	picked.sort((a, b) => a.startAt.localeCompare(b.startAt));
	return picked;
}

/**
 * "Tuesday, July 7 at 9:00 AM" — how a slot reads in the account's zone. When
 * `currentYear` is given and the slot falls in a different year, the year is
 * spelled out ("Monday, January 4, 2027 at 9:00 AM") so a booking that crosses
 * the year boundary can never read as this week.
 */
export function formatSlotLabel(
	startAt: IsoDateString,
	timeZone: string,
	currentYear?: number,
): string {
	const slotYear = zonedParts(new Date(startAt), timeZone).year;
	const day = new Intl.DateTimeFormat('en-US', {
		timeZone,
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		...(currentYear !== undefined && slotYear !== currentYear ? { year: 'numeric' } : {}),
	}).format(new Date(startAt));
	const time = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hour: 'numeric',
		minute: '2-digit',
		hour12: true,
	}).format(new Date(startAt));
	return `${day} at ${time}`;
}

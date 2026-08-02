import type { AgentSlot, IsoDateString } from '@rivus/core';
import { instantForZonedTime, zonedParts } from './slots';

/**
 * Deterministic reading of a customer's scheduling reply. No model in the
 * loop on purpose: picking "option 2" or "Tuesday at 2pm" is regular enough
 * to parse exactly, an exact parser can't hallucinate a booking time, and the
 * whole flow stays hermetic under test. Anything these parsers can't read,
 * the engine answers by (re)offering concrete slots.
 */

export interface ParseTimeContext {
	/** IANA zone customer times are written in (the account's zone). */
	timeZone: string;
	/** The current instant — "tomorrow"/"Tuesday" resolve relative to this. */
	now: Date;
}

/** A calendar day in the account's zone, with no time of day attached. */
export interface RequestedDay {
	year: number;
	month: number;
	day: number;
}

const ORDINAL_WORDS: Record<string, number> = {
	first: 1,
	second: 2,
	third: 3,
	fourth: 4,
	fifth: 5,
	one: 1,
	two: 2,
	three: 3,
	four: 4,
	five: 5,
};

const MONTHS: Record<string, number> = {
	jan: 1,
	feb: 2,
	mar: 3,
	apr: 4,
	may: 5,
	jun: 6,
	jul: 7,
	aug: 8,
	sep: 9,
	oct: 10,
	nov: 11,
	dec: 12,
};

const WEEKDAYS: Record<string, number> = {
	sun: 0,
	mon: 1,
	tue: 2,
	wed: 3,
	thu: 4,
	fri: 5,
	sat: 6,
};

// A day named in full, in the forms people actually write — the same vocabulary
// `question.ts` treats as a calendar reference. Deliberately NOT the looser
// `(sun|mon|…)[a-z]*` the offer matchers use: those only run against a set of
// slots already on the table, while {@link parseRequestedDay} reads every turn,
// where "my friend recommended you" and "a heater for my sunroom" must not
// become Friday and Sunday. The captured group always starts with the
// three-letter key {@link WEEKDAYS} is indexed by.
const WEEKDAY_WORD =
	/\b(?:(?:next|this) )?(sun|sunday|mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday)\b/;

// A reply that says no. Any of these anywhere in the message disables the
// slot-*picking* paths — "the first one doesn't work" must never book slot 1.
// Time *proposals* stay enabled: "Tuesday doesn't work, how about Wednesday at
// 2?" still parses Wednesday, because the proposal parser runs regardless.
const NEGATION =
	/\b(?:doesn'?t|does not|don'?t|do not|won'?t|will not|can'?t|cannot|couldn'?t|isn'?t|is not|not going to|no longer|none of|neither|nope)\b/;

// Where one clause of a rejection ends and the alternative begins: sentence
// punctuation, or a pivot word that introduces the counter-offer. Shared by the
// time and day parsers so both read "Thursday doesn't work, how about Friday?"
// as a request for Friday rather than as no request at all.
const CLAUSE_BOUNDARY = /[,;.?!\n–—]+|\b(?:but|how about|what about|instead|though)\b/;

/** Whether a reply contains a negation that makes a slot pick unsafe to infer. */
function refusesPick(normalized: string): boolean {
	return NEGATION.test(normalized);
}

// An explicit calendar reference — a day-of-month ("the 14th"), a month name,
// or an ISO date. When one is present, fuzzy weekday matching must not run:
// "Tuesday the 14th at 9am" names a specific date, and if the date parser
// couldn't resolve it the safe answer is to re-offer, not to book the offered
// Tuesday a week earlier.
const EXPLICIT_DATE =
	/\b\d{1,2}(?:st|nd|rd|th)\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b/;

// A day named relative to today. Like {@link EXPLICIT_DATE} it points at one
// calendar day the offer matcher cannot check the offers against, so a time
// standing next to it ("tomorrow at 2pm") must never pick the 2 PM on some
// other offered day; {@link parseProposedTime} reads the day and the time
// together and books what was actually said.
const RELATIVE_DAY = /\b(?:today|tonight|tomorrow)\b/;

// The clock time in a reply that also names a weekday: the first number in the
// message, minutes and meridiem optional. Loose on purpose — the day is already
// pinned down, so the hour only has to choose between that day's offers
// ("tuesday at 9 works").
const DAY_SCOPED_TIME = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/;

// The clock time in a reply that names no day at all, where the time IS the
// whole pick: digits with a meridiem ("1pm", "1 pm"), or with colon-minutes
// ("13:00", "1:30pm"). A bare digit is deliberately not a time here — with a
// numbered list on the table "lets do 1" is indistinguishable from a pick of
// option 1, the same reasoning that keeps a bare ordinal out of
// {@link parseRequestedDay}. The whole message is searched rather than only its
// first number: in "in 20 mins can we do 1pm?" the first number is the
// meridiem-less 20, and the time the customer named comes after it.
const STANDALONE_TIME = /\b(\d{1,2}):(\d{2})\s*(am|pm)?\b|\b(\d{1,2})\s*(am|pm)\b/;

/** A clock time a reply pinned down: a 24-hour hour, and minutes when it gave them. */
interface WantedTime {
	hour: number;
	minute: number | null;
}

function wantedTime(
	hourText: string,
	minuteText: string | undefined,
	meridiem: string | undefined,
): WantedTime | null {
	const hour = resolveHour(Number(hourText), meridiem);
	if (hour === null) {
		return null;
	}
	return { hour, minute: minuteText === undefined ? null : Number(minuteText) };
}

function dayScopedTime(normalized: string): WantedTime | null {
	const match = normalized.match(DAY_SCOPED_TIME);
	return match?.[1] ? wantedTime(match[1], match[2], match[3]) : null;
}

function standaloneTime(normalized: string): WantedTime | null {
	if (RELATIVE_DAY.test(normalized)) {
		return null;
	}
	const match = normalized.match(STANDALONE_TIME);
	if (match?.[1]) {
		return wantedTime(match[1], match[2], match[3]);
	}
	if (match?.[4]) {
		return wantedTime(match[4], undefined, match[5]);
	}
	return null;
}

/**
 * Which offered slot (1-based → 0-based index) a reply picks, or null when it
 * doesn't clearly pick one. Understands "2", "option 2", "#2", "the second
 * one", "the last one". A number that isn't a standalone pick (e.g. the 2 in
 * "Tuesday at 2pm") never matches, so time proposals fall through to
 * {@link parseProposedTime}.
 */
export function parseSlotChoice(text: string, offeredCount: number): number | null {
	if (offeredCount <= 0) {
		return null;
	}
	const normalized = text.toLowerCase();
	if (refusesPick(normalized)) {
		return null;
	}
	let pick: number | null = null;

	// `#N` is deliberately absent here: mid-sentence it is far more often an
	// apartment or street number ("45 Main St #2") than a pick; a standalone
	// "#2" still matches through the bare-number path below.
	const keyworded = normalized.match(/(?:\boption|\bchoice|\bslot|\bnumber)\s*#?(\d{1,2})\b/);
	if (keyworded?.[1]) {
		pick = Number(keyworded[1]);
	} else if (/(?:^|\b)(?:the\s+)?last\s+one\b/.test(normalized)) {
		pick = offeredCount;
	} else {
		// An ordinal only counts mid-sentence when it names an offer explicitly
		// ("the second one/slot/option/time") — a bare "second" in passing ("I
		// need a second visit", "first thing in the morning") is not a pick.
		const ordinal = normalized.match(
			/\b(?:the\s+)?(first|second|third|fourth|fifth)\s+(?:one|slot|option|time)\b/,
		);
		if (ordinal?.[1]) {
			pick = ORDINAL_WORDS[ordinal[1]] ?? null;
		} else {
			// A bare number is only a pick when the whole message is (roughly) just
			// that number — "2", "2!", "2 please", "#2 works".
			const bare = normalized
				.trim()
				.match(/^(?:i(?:'|’)?ll\s+take\s+)?#?(\d{1,2})\s*(?:please|works|thanks|thank you|!|\.)*$/);
			if (bare?.[1]) {
				pick = Number(bare[1]);
			} else {
				// Same whole-message rule for spelled-out picks — "first", "two
				// please", "second works" — so an unadorned ordinal still needs the
				// message to be about nothing else.
				const word = normalized
					.trim()
					.match(
						/^(?:the\s+)?(one|two|three|four|five|first|second|third|fourth|fifth)\s*(?:please|works|thanks|thank you|!|\.)*$/,
					);
				if (word?.[1]) {
					pick = ORDINAL_WORDS[word[1]] ?? null;
				}
			}
		}
	}

	if (pick === null || pick < 1 || pick > offeredCount) {
		return null;
	}
	return pick - 1;
}

/**
 * Which offered slot a reply names by day and/or by time — "Tuesday works",
 * "the 10am on Tuesday", "lets do 1pm" — or null unless exactly one offered
 * slot matches everything the reply pinned down. Ambiguity is never guessed:
 * two Tuesday offers and "Tuesday works" → null, two 9:00 AM offers on
 * different days and "9am" → null, and the engine restates the options.
 *
 * A time with no day behind it only counts when it is unmistakably a clock
 * ("1pm", "13:00"); a bare digit stays a candidate pick of option 1, never a
 * time. Minutes, when the reply gives them, must match the slot's — "1:30pm"
 * never books the 1:00 PM window, because the agent must not book a time
 * nobody named.
 */
export function matchOfferedSlot(
	text: string,
	offeredSlots: AgentSlot[],
	timeZone: string,
): number | null {
	if (offeredSlots.length === 0) {
		return null;
	}
	const normalized = text.toLowerCase();
	if (refusesPick(normalized) || EXPLICIT_DATE.test(normalized)) {
		return null;
	}
	const weekdayMatch = normalized.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/);
	const weekday = weekdayMatch?.[1] ? WEEKDAYS[weekdayMatch[1]] : undefined;
	const wanted = weekday === undefined ? standaloneTime(normalized) : dayScopedTime(normalized);
	// A reply that pinned down neither a day nor a clock picks nothing.
	if (weekday === undefined && wanted === null) {
		return null;
	}

	const matches: number[] = [];
	offeredSlots.forEach((slot, index) => {
		const parts = zonedParts(new Date(slot.startAt), timeZone);
		if (weekday !== undefined && parts.weekday !== weekday) {
			return;
		}
		if (wanted) {
			if (parts.hour !== wanted.hour) {
				return;
			}
			// Minutes only narrow when the reply spelled them out, and then exactly.
			if (wanted.minute !== null && parts.minute !== wanted.minute) {
				return;
			}
		}
		matches.push(index);
	});
	return matches.length === 1 ? (matches[0] ?? null) : null;
}

/**
 * Resolve a written hour to a 24-hour clock. Without am/pm, small hours are
 * read as afternoon ("at 2" → 14:00 — the business day runs 9–17, so 2am is
 * never what a customer means), 8–12 as written (morning, noon), and 13–23 as
 * 24-hour notation.
 */
function resolveHour(hour: number, meridiem: string | undefined): number | null {
	if (hour < 0 || hour > 23) {
		return null;
	}
	if (meridiem === 'am') {
		return hour === 12 ? 0 : hour;
	}
	if (meridiem === 'pm') {
		return hour === 12 ? 12 : hour + 12;
	}
	if (hour <= 7) {
		return hour + 12;
	}
	return hour;
}

/** A calendar date that survives round-tripping (rejects Feb 30 etc.). */
function isRealDate(year: number, month: number, day: number): boolean {
	if (month < 1 || month > 12 || day < 1 || day > 31) {
		return false;
	}
	const probe = new Date(Date.UTC(year, month - 1, day));
	return probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

function isRealTime(hour: number | null, minute: number): boolean {
	return hour !== null && minute >= 0 && minute <= 59;
}

// Greetings and pure connectors that carry no scheduling content. They may sit
// anywhere around an acknowledgement without turning it into a request, so the
// consumer below skips them. Deliberately excludes words that often *lead* a new
// ask ("but", "can", "actually", "what", "also"-followed-by-a-verb), so those
// keep an unrecognized token in the message and fail the whole-message match.
const ACK_FILLER_WORDS = [
	'hi',
	'hello',
	'hey',
	'hiya',
	'yo',
	'there',
	'and',
	'then',
	'so',
	'really',
	'very',
	'much',
	'just',
	'well',
	'please',
];

// Complete acknowledgement phrases — an affirmation, a thanks, or a sign-off —
// ordered most-specific-first so a greedy leading match consumes the longest
// form. A reply built only of these (plus filler) is a pure acknowledgement;
// any other word ("open", "else", "reschedule", "sooner") stays unconsumed and
// the reply is treated as a real scheduling turn instead.
const ACK_PHRASES = [
	'consider it confirmed',
	'consider it done',
	'that is confirmed',
	'thats confirmed',
	'i confirm',
	'confirming',
	'confirmed',
	'confirm',
	'sounds like a plan',
	'that sounds good',
	'that sounds great',
	'that sounds perfect',
	'sounds good to me',
	'sounds good',
	'sounds great',
	'sounds perfect',
	'sounds wonderful',
	'sounds lovely',
	'that looks good',
	'that looks great',
	'looks good',
	'looks great',
	'that works for me',
	'that works great',
	'that works perfectly',
	'that works',
	'that will work',
	'thatll work',
	'works for me',
	'works great',
	'works perfectly',
	'works',
	'that is great',
	'that is perfect',
	'that is fine',
	'thats great',
	'thats perfect',
	'thats fine',
	'thats good',
	'of course',
	'for sure',
	'you bet',
	'sure thing',
	'sure',
	'absolutely',
	'definitely',
	'certainly',
	'okay',
	'okey',
	'okie',
	'ok',
	'kk',
	'k',
	'alrighty',
	'alright',
	'roger that',
	'roger',
	'yes',
	'yep',
	'yeah',
	'yup',
	'ya',
	'perfect',
	'great',
	'awesome',
	'excellent',
	'wonderful',
	'fantastic',
	'cool',
	'nice',
	'lovely',
	'brilliant',
	'amazing',
	'terrific',
	'splendid',
	'fabulous',
	'fab',
	'super',
	'good',
	'fine',
	'thank you so much',
	'thank you very much',
	'thank you again',
	'thank you',
	'thankyou',
	'thanks so much',
	'thanks a lot',
	'thanks again',
	'thanks',
	'thx',
	'tysm',
	'ty',
	'cheers',
	'much appreciated',
	'appreciated',
	'i appreciate it',
	'appreciate it',
	'see you then',
	'see you soon',
	'see you there',
	'see you',
	'see ya then',
	'see ya soon',
	'see ya',
	'see u then',
	'see u soon',
	'see u',
	'catch you then',
	'catch you later',
	'talk soon',
	'speak soon',
	'will do',
	'got it',
	'gotcha',
	'understood',
	'duly noted',
	'noted',
	'done',
	'im all set',
	'i am all set',
	'were all set',
	'we are all set',
	'all set',
	'no problem',
	'no worries',
];

// Head-anchored matchers: a leading filler word, or a leading acknowledgement
// phrase, each requiring a word boundary (a following space or end of string) so
// "great" never matches inside "greater". Phrases carry only letters and spaces,
// so no escaping is needed.
const ACK_FILLER_HEAD = new RegExp(`^(?:${ACK_FILLER_WORDS.join('|')})(?:\\s+|$)`);
const ACK_PHRASE_HEAD = new RegExp(`^(?:${ACK_PHRASES.join('|')})(?:\\s+|$)`);

/**
 * Whether a reply is a pure acknowledgement — "Confirmed!", "ok", "sounds good,
 * thanks", "great — see you then!" — with no fresh scheduling ask in it. Used
 * once a job is booked so a simple "thanks!" reassures the standing booking
 * instead of reopening scheduling; a genuine new request ("what else is open?")
 * is not an acknowledgement and still gets concrete slots.
 *
 * Conservative by construction: the message is normalized to letters, then
 * consumed left to right, dropping a filler word or a whole acknowledgement
 * phrase at each step. It is an acknowledgement only when the *entire* message is
 * consumed and at least one real acknowledgement was seen — so anything carrying
 * more than an affirmation ("ok but what else do you have?") never matches.
 */
export function isAcknowledgement(text: string): boolean {
	const normalized = text
		.toLowerCase()
		// Drop apostrophes so "that's"/"i'm" read as "thats"/"im", then map
		// punctuation, symbols, and emoji to spaces. Digits are deliberately kept:
		// a reply carrying numeric scheduling content ("10 works", "7/10", "ok
		// 7/10") is a real turn, not a bare acknowledgement, so the stray number
		// must survive as an unrecognized token and fail the whole-message check
		// below rather than being discarded down to "works"/"ok".
		.replace(/['’]/g, '')
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (normalized === '') {
		return false;
	}
	let rest = normalized;
	let sawAcknowledgement = false;
	while (rest !== '') {
		const filler = rest.match(ACK_FILLER_HEAD);
		if (filler) {
			rest = rest.slice(filler[0].length);
			continue;
		}
		const phrase = rest.match(ACK_PHRASE_HEAD);
		if (phrase) {
			sawAcknowledgement = true;
			rest = rest.slice(phrase[0].length);
			continue;
		}
		// An unrecognized word — the reply says more than "yes/thanks", so it is a
		// real scheduling turn, not a bare acknowledgement.
		return false;
	}
	return sawAcknowledgement;
}

/**
 * The specific instant a reply proposes ("July 10 at 2pm", "10 July 14:00",
 * "2026-07-10 14:00", "Tuesday at 2pm", "tomorrow at 9"), as a UTC ISO
 * string, or null when the reply names no complete day + time. A date with no
 * time (or a time with no day) is not enough to book, so it parses to null
 * and the engine offers concrete options instead of guessing.
 */
export function parseProposedTime(text: string, context: ParseTimeContext): IsoDateString | null {
	const normalized = text.toLowerCase().replace(/\s+/g, ' ');
	if (!NEGATION.test(normalized)) {
		return parseTimeClause(normalized, context);
	}
	// A negated time must never be booked: "I can't do Tuesday at 2" proposes
	// nothing. But the alternative half of "Tuesday doesn't work, how about
	// Wednesday at 3?" still does — so read clause by clause, skipping any
	// clause that says no.
	for (const clause of normalized.split(CLAUSE_BOUNDARY)) {
		if (NEGATION.test(clause)) {
			continue;
		}
		const proposed = parseTimeClause(clause, context);
		if (proposed) {
			return proposed;
		}
	}
	return null;
}

function parseTimeClause(normalized: string, context: ParseTimeContext): IsoDateString | null {
	const today = zonedParts(context.now, context.timeZone);

	// 2026-07-10 14:00 / 2026-07-10T14:00 — an explicit wall-clock time in the
	// account's zone (senders write local times, not UTC).
	const iso = normalized.match(/\b(\d{4})-(\d{2})-(\d{2})[t ](\d{1,2}):(\d{2})\b/);
	if (iso) {
		const [, y, m, d, hh, mm] = iso;
		return buildInstant(
			context,
			{ year: Number(y), month: Number(m), day: Number(d) },
			Number(hh) <= 23 ? Number(hh) : null,
			Number(mm),
			// An explicit date is taken at face value even if it's in the past —
			// the engine rejects past instants with a clearer message than "unparsed".
			{ rollForward: false },
		);
	}

	// july 10 (2026)? at 2(:30)? pm
	const monthFirst = normalized.match(
		/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))? (?:at )?(\d{1,2})(?::(\d{2}))? ?(am|pm)?\b/,
	);
	if (monthFirst) {
		const [, monthWord, dayText, yearText, hourText, minuteText, meridiem] = monthFirst;
		return buildInstant(
			context,
			{
				year: yearText ? Number(yearText) : today.year,
				month: MONTHS[monthWord ?? ''] ?? 0,
				day: Number(dayText),
			},
			resolveHour(Number(hourText), meridiem),
			minuteText ? Number(minuteText) : 0,
			{ rollForward: !yearText },
		);
	}

	// 10 july at 14:00
	const dayFirst = normalized.match(
		/\b(\d{1,2})(?:st|nd|rd|th)? (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,? (\d{4}))? (?:at )?(\d{1,2})(?::(\d{2}))? ?(am|pm)?\b/,
	);
	if (dayFirst) {
		const [, dayText, monthWord, yearText, hourText, minuteText, meridiem] = dayFirst;
		return buildInstant(
			context,
			{
				year: yearText ? Number(yearText) : today.year,
				month: MONTHS[monthWord ?? ''] ?? 0,
				day: Number(dayText),
			},
			resolveHour(Number(hourText), meridiem),
			minuteText ? Number(minuteText) : 0,
			{ rollForward: !yearText },
		);
	}

	// tomorrow / today at 9(:30)? (am|pm)?
	const relative = normalized.match(
		/\b(today|tomorrow) (?:at )?(\d{1,2})(?::(\d{2}))? ?(am|pm)?\b/,
	);
	if (relative) {
		const [, dayWord, hourText, minuteText, meridiem] = relative;
		const offset = dayWord === 'tomorrow' ? 1 : 0;
		const cursor = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
		return buildInstant(
			context,
			{
				year: cursor.getUTCFullYear(),
				month: cursor.getUTCMonth() + 1,
				day: cursor.getUTCDate(),
			},
			resolveHour(Number(hourText), meridiem),
			minuteText ? Number(minuteText) : 0,
			{ rollForward: false },
		);
	}

	// (next )?tuesday at 2(:30)? (am|pm)? — the next occurrence after now.
	const weekday = normalized.match(
		/\b(?:next )?(sun|mon|tue|wed|thu|fri|sat)[a-z]* (?:at )?(\d{1,2})(?::(\d{2}))? ?(am|pm)?\b/,
	);
	if (weekday) {
		const [, dayWord, hourText, minuteText, meridiem] = weekday;
		const wanted = WEEKDAYS[dayWord ?? ''] ?? 0;
		const hour = resolveHour(Number(hourText), meridiem);
		const minute = minuteText ? Number(minuteText) : 0;
		if (!isRealTime(hour, minute)) {
			return null;
		}
		// Scan the next 14 local days for the weekday; skip an occurrence whose
		// time has already passed ("Tuesday at 2pm" said Tuesday 3pm → next week).
		for (let offset = 0; offset <= 14; offset += 1) {
			const cursor = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
			const candidate = {
				year: cursor.getUTCFullYear(),
				month: cursor.getUTCMonth() + 1,
				day: cursor.getUTCDate(),
			};
			const instant = instantForZonedTime(context.timeZone, {
				...candidate,
				hour: hour as number,
				minute,
			});
			if (zonedParts(instant, context.timeZone).weekday !== wanted) {
				continue;
			}
			if (instant.getTime() > context.now.getTime()) {
				return instant.toISOString();
			}
		}
		return null;
	}

	return null;
}

/**
 * The calendar DAY a reply names when it names no usable clock time — "next
 * Thursday", "August 6", "tomorrow", "2026-08-06" — read in the account's zone,
 * or null when it names no day at all.
 *
 * The engine calls this only AFTER {@link parseProposedTime} has returned null,
 * so a complete day + time ("Thursday at 2pm") never reaches here: the two
 * parsers deliberately recognize the same day forms rather than guarding
 * against each other, and precedence lives in the engine. Same conservatism as
 * the rest of this file — a day it cannot read exactly is null, and the engine
 * re-offers rather than guessing which day was meant.
 */
export function parseRequestedDay(text: string, context: ParseTimeContext): RequestedDay | null {
	const normalized = text.toLowerCase().replace(/\s+/g, ' ');
	if (!NEGATION.test(normalized)) {
		return parseDayClause(normalized, context);
	}
	// A negated day asks for nothing: "I can't do Thursday" names no day to look
	// at. The alternative half of "Thursday doesn't work, how about Friday?"
	// still does — so read clause by clause, skipping any clause that says no.
	for (const clause of normalized.split(CLAUSE_BOUNDARY)) {
		if (NEGATION.test(clause)) {
			continue;
		}
		const day = parseDayClause(clause, context);
		if (day) {
			return day;
		}
	}
	return null;
}

function parseDayClause(normalized: string, context: ParseTimeContext): RequestedDay | null {
	const today = zonedParts(context.now, context.timeZone);

	// 2026-08-06 — an explicit date, taken at face value even when it is already
	// past (as in {@link parseTimeClause}): the engine declines a past day with a
	// reason, which reads better than treating the message as unparseable.
	const iso = normalized.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
	if (iso) {
		const [, yearText, monthText, dayText] = iso;
		return realDay(Number(yearText), Number(monthText), Number(dayText));
	}

	// august 6 / aug 6th / august 6, 2027
	const monthFirst = normalized.match(
		/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?\b/,
	);
	if (monthFirst) {
		const [, monthWord, dayText, yearText] = monthFirst;
		const parsed = realDay(
			yearText ? Number(yearText) : today.year,
			MONTHS[monthWord ?? ''] ?? 0,
			Number(dayText),
		);
		return parsed && !yearText ? rollYearForward(parsed, today) : parsed;
	}

	// 6 august / 6th of august / 6 aug 2027
	const dayFirst = normalized.match(
		/\b(\d{1,2})(?:st|nd|rd|th)? (?:of )?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,? (\d{4}))?\b/,
	);
	if (dayFirst) {
		const [, dayText, monthWord, yearText] = dayFirst;
		const parsed = realDay(
			yearText ? Number(yearText) : today.year,
			MONTHS[monthWord ?? ''] ?? 0,
			Number(dayText),
		);
		return parsed && !yearText ? rollYearForward(parsed, today) : parsed;
	}

	// today / tomorrow as bare words — the "today at 3pm" forms belong to
	// {@link parseTimeClause}. Day arithmetic runs on a UTC-normalized (y, m, d)
	// triple so month/year rollover is Date.UTC's problem, not ours.
	const relative = normalized.match(/\b(today|tomorrow)\b/);
	if (relative) {
		const cursor = new Date(
			Date.UTC(today.year, today.month - 1, today.day + (relative[1] === 'tomorrow' ? 1 : 0)),
		);
		return realDay(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate());
	}

	// (next |this )?thursday — the next occurrence, scanning local days 1..7.
	// Never today: someone asking "Thursday?" on a Thursday means next week's, and
	// a contact who means today has the word "today". "next"/"this" are read as
	// noise, matching parseProposedTime's convention — people write both for the
	// same day, and neither changes which occurrence they mean.
	const weekday = normalized.match(WEEKDAY_WORD);
	if (weekday?.[1]) {
		const wanted = WEEKDAYS[weekday[1].slice(0, 3)] ?? 0;
		for (let offset = 1; offset <= 7; offset += 1) {
			const cursor = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
			const candidate = {
				year: cursor.getUTCFullYear(),
				month: cursor.getUTCMonth() + 1,
				day: cursor.getUTCDate(),
			};
			// The weekday is read back from a resolved instant (not assumed from the
			// cursor) so zones far from UTC classify the right local day. Midday is
			// used because no DST shift can move it off its own calendar day.
			const instant = instantForZonedTime(context.timeZone, {
				...candidate,
				hour: 12,
				minute: 0,
			});
			if (zonedParts(instant, context.timeZone).weekday === wanted) {
				return candidate;
			}
		}
	}

	return null;
}

/** The parts as a calendar day, or null when they don't name a real one (Feb 30). */
function realDay(year: number, month: number, day: number): RequestedDay | null {
	return isRealDate(year, month, day) ? { year, month, day } : null;
}

/**
 * A month-day written with no year means the next such date: "January 5" said in
 * December points at next January. Compared as (y, m, d) triples rather than
 * instants — a day counts as past only once the whole calendar day is behind
 * today, so "August 2" asked on August 2 still means today.
 */
function rollYearForward(date: RequestedDay, today: RequestedDay): RequestedDay {
	const ordered = (parts: RequestedDay) => parts.year * 10_000 + parts.month * 100 + parts.day;
	if (ordered(date) >= ordered(today)) {
		return date;
	}
	// The next year that actually has this day. Only February 29 can skip years —
	// blindly taking year + 1 would hand the engine a date Date.UTC quietly
	// normalizes to March 1 — and a leap year is never more than eight away.
	let year = date.year + 1;
	while (!isRealDate(year, date.month, date.day)) {
		year += 1;
	}
	return { ...date, year };
}

function buildInstant(
	context: ParseTimeContext,
	date: { year: number; month: number; day: number },
	hour: number | null,
	minute: number,
	options: { rollForward: boolean },
): IsoDateString | null {
	if (!isRealDate(date.year, date.month, date.day) || !isRealTime(hour, minute)) {
		return null;
	}
	let instant = instantForZonedTime(context.timeZone, {
		...date,
		hour: hour as number,
		minute,
	});
	// A month-day with no year means the next such date: "January 5" written in
	// December points at next January.
	if (options.rollForward && instant.getTime() <= context.now.getTime()) {
		instant = instantForZonedTime(context.timeZone, {
			...date,
			year: date.year + 1,
			hour: hour as number,
			minute,
		});
	}
	return instant.toISOString();
}

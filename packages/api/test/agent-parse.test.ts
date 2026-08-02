import type { AgentSlot } from '@rivus/core';
import { describe, expect, it } from 'vitest';
import {
	isAcknowledgement,
	matchOfferedSlot,
	namesAdditionalVisit,
	parseProposedTime,
	parseRequestedDay,
	parseSlotChoice,
} from '../src/services/agent/parse';

const PACIFIC = 'America/Los_Angeles';
// Wednesday July 1st 2026, 10:00 AM PDT.
const NOW = new Date('2026-07-01T17:00:00.000Z');
const CTX = { timeZone: PACIFIC, now: NOW };

describe('parseSlotChoice', () => {
	it.each([
		['1', 0],
		['2', 1],
		['2!', 1],
		['2 please', 1],
		['#3', 2],
		['option 2', 1],
		['Option 2 works great, thanks!', 1],
		['slot 1', 0],
		['choice 3', 2],
		['number 2', 1],
		["I'll take 2", 1],
		['first', 0],
		['The second one', 1],
		['the third option', 2],
		['the last one works', 2],
		['two', 1],
	])('reads %j as a pick of slot %i', (text, index) => {
		expect(parseSlotChoice(text, 3)).toBe(index);
	});

	it.each([
		'Tuesday at 2pm', // a time proposal, not a pick
		'can we do 2pm?', // ditto — the 2 belongs to a time
		'none of those work',
		'what about next week?',
		'',
	])('does not read %j as a pick', (text) => {
		expect(parseSlotChoice(text, 3)).toBeNull();
	});

	it('rejects picks outside the offered range', () => {
		expect(parseSlotChoice('4', 3)).toBeNull();
		expect(parseSlotChoice('0', 3)).toBeNull();
		expect(parseSlotChoice('option 9', 3)).toBeNull();
	});

	it('never matches when nothing was offered', () => {
		expect(parseSlotChoice('1', 0)).toBeNull();
	});
});

describe('matchOfferedSlot', () => {
	// Tuesday July 7th 9:00 AM and Thursday July 9th 2:00 PM, Pacific.
	const offered: AgentSlot[] = [
		{ startAt: '2026-07-07T16:00:00.000Z', durationMinutes: 60 },
		{ startAt: '2026-07-09T21:00:00.000Z', durationMinutes: 60 },
	];

	it('matches a slot by naming its day', () => {
		expect(matchOfferedSlot('Tuesday works for me', offered, PACIFIC)).toBe(0);
		expect(matchOfferedSlot('thursday is best', offered, PACIFIC)).toBe(1);
	});

	it('matches a slot by day and hour', () => {
		expect(matchOfferedSlot('tuesday at 9 works', offered, PACIFIC)).toBe(0);
		expect(matchOfferedSlot('the 2pm on thursday', offered, PACIFIC)).toBe(1);
	});

	it('returns null when the named day matches no offer', () => {
		expect(matchOfferedSlot('friday works', offered, PACIFIC)).toBeNull();
	});

	it('returns null when the day is ambiguous across offers', () => {
		const twoTuesdays: AgentSlot[] = [
			{ startAt: '2026-07-07T16:00:00.000Z', durationMinutes: 60 },
			{ startAt: '2026-07-07T21:00:00.000Z', durationMinutes: 60 },
		];
		expect(matchOfferedSlot('tuesday works', twoTuesdays, PACIFIC)).toBeNull();
		// A time disambiguates.
		expect(matchOfferedSlot('tuesday at 2pm works', twoTuesdays, PACIFIC)).toBe(1);
	});

	it.each([
		['lets do 2pm', 1],
		['2 pm works', 1],
		['9am please', 0],
		['2:00pm', 1],
		['14:00', 1],
		['can we do 2:00 pm?', 1],
	])('matches %j to slot %i on its time alone', (text, index) => {
		expect(matchOfferedSlot(text, offered, PACIFIC)).toBe(index);
	});

	it('never reads a bare digit as a time — it is a candidate pick, not a clock', () => {
		expect(matchOfferedSlot('lets do 2', offered, PACIFIC)).toBeNull();
	});

	it('never picks a window the reply did not name', () => {
		// Minutes were spelled out and no offer is at 2:30, with or without a day.
		expect(matchOfferedSlot('2:30pm', offered, PACIFIC)).toBeNull();
		expect(matchOfferedSlot('thursday at 2:30pm', offered, PACIFIC)).toBeNull();
		// Nothing is on offer at that hour at all.
		expect(matchOfferedSlot('10am', offered, PACIFIC)).toBeNull();
		// An impossible hour reads as no clock time at all.
		expect(matchOfferedSlot('25:00', offered, PACIFIC)).toBeNull();
	});

	it('returns null when a bare time is ambiguous across days', () => {
		// Tuesday July 7th and Wednesday July 8th, both at 9:00 AM Pacific.
		const twoMornings: AgentSlot[] = [
			{ startAt: '2026-07-07T16:00:00.000Z', durationMinutes: 60 },
			{ startAt: '2026-07-08T16:00:00.000Z', durationMinutes: 60 },
		];
		expect(matchOfferedSlot('9am works', twoMornings, PACIFIC)).toBeNull();
		// Naming the day still disambiguates.
		expect(matchOfferedSlot('wednesday at 9am', twoMornings, PACIFIC)).toBe(1);
	});

	it('returns null when the reply pins nothing down, or with nothing offered', () => {
		expect(matchOfferedSlot('sounds good', offered, PACIFIC)).toBeNull();
		expect(matchOfferedSlot('tuesday', [], PACIFIC)).toBeNull();
	});
});

describe('parseProposedTime', () => {
	it('parses "Month day at time" with am/pm', () => {
		// 2:00 PM PDT = 21:00 UTC.
		expect(parseProposedTime('How about July 10 at 2pm?', CTX)).toBe('2026-07-10T21:00:00.000Z');
		expect(parseProposedTime('july 10th at 2:30 pm', CTX)).toBe('2026-07-10T21:30:00.000Z');
	});

	it('parses "day Month" (international order) with a 24h clock', () => {
		expect(parseProposedTime('10 July at 14:00', CTX)).toBe('2026-07-10T21:00:00.000Z');
	});

	it('parses an explicit ISO-style date-time as account-local wall clock', () => {
		expect(parseProposedTime('2026-07-10 14:00', CTX)).toBe('2026-07-10T21:00:00.000Z');
		expect(parseProposedTime('2026-07-10T09:00', CTX)).toBe('2026-07-10T16:00:00.000Z');
	});

	it('parses tomorrow/today with an hour', () => {
		// Tomorrow = Thursday July 2nd; 9 AM PDT = 16:00 UTC.
		expect(parseProposedTime('tomorrow at 9am', CTX)).toBe('2026-07-02T16:00:00.000Z');
		// Today 3 PM PDT = 22:00 UTC.
		expect(parseProposedTime('today at 3pm', CTX)).toBe('2026-07-01T22:00:00.000Z');
	});

	it('reads a small bare hour as afternoon (business hours run 9–5)', () => {
		// "at 2" → 2 PM, not 2 AM.
		expect(parseProposedTime('tomorrow at 2', CTX)).toBe('2026-07-02T21:00:00.000Z');
	});

	it('parses a weekday as its next future occurrence', () => {
		// Next Tuesday after Wednesday July 1st is July 7th; 2 PM PDT = 21:00 UTC.
		expect(parseProposedTime('Tuesday at 2pm?', CTX)).toBe('2026-07-07T21:00:00.000Z');
		expect(parseProposedTime('next tuesday at 2pm', CTX)).toBe('2026-07-07T21:00:00.000Z');
	});

	it('rolls a same-day weekday whose time already passed to next week', () => {
		// It is Wednesday 10 AM; "Wednesday at 9am" must mean July 8th.
		expect(parseProposedTime('Wednesday at 9am', CTX)).toBe('2026-07-08T16:00:00.000Z');
		// …but "Wednesday at 11am" is still today.
		expect(parseProposedTime('Wednesday at 11am', CTX)).toBe('2026-07-01T18:00:00.000Z');
	});

	it('rolls a year-less month-day that already passed into next year', () => {
		expect(parseProposedTime('January 5 at 9am', CTX)).toBe('2027-01-05T17:00:00.000Z');
	});

	it('keeps an explicit past date in the past (the engine rejects it with a reason)', () => {
		expect(parseProposedTime('2026-06-01 09:00', CTX)).toBe('2026-06-01T16:00:00.000Z');
	});

	it('rejects impossible dates and times', () => {
		expect(parseProposedTime('February 30 at 9am', CTX)).toBeNull();
		expect(parseProposedTime('2026-13-01 09:00', CTX)).toBeNull();
		expect(parseProposedTime('tomorrow at 9:75', CTX)).toBeNull();
	});

	it('rejects an hour no 12-hour clock has, and keeps the two that look like it', () => {
		// "13am" and "0pm" are a typo or were never a time; either reading is a guess.
		expect(parseProposedTime('July 10 at 13am', CTX)).toBeNull();
		expect(parseProposedTime('July 10 at 0pm', CTX)).toBeNull();
		// Noon and midnight are the hours the bound must leave alone.
		expect(parseProposedTime('July 10 at 12pm', CTX)).toBe('2026-07-10T19:00:00.000Z');
		expect(parseProposedTime('July 10 at 12am', CTX)).toBe('2026-07-10T07:00:00.000Z');
	});

	it('returns null when no complete day + time is named', () => {
		expect(parseProposedTime('sometime next week?', CTX)).toBeNull();
		expect(parseProposedTime('at 2pm', CTX)).toBeNull(); // time, no day
		expect(parseProposedTime('2026-07-10', CTX)).toBeNull(); // day, no time
		expect(parseProposedTime('tomorrow', CTX)).toBeNull(); // day, no time
		expect(parseProposedTime('Hi, I need help with my sink.', CTX)).toBeNull();
		expect(parseProposedTime('', CTX)).toBeNull();
	});

	it('respects the account timezone when resolving wall-clock times', () => {
		const utc = parseProposedTime('July 10 at 2pm', { timeZone: 'UTC', now: NOW });
		expect(utc).toBe('2026-07-10T14:00:00.000Z');
	});
});

describe('parseSlotChoice — negation guard', () => {
	it.each([
		"The first one doesn't work for me, sadly",
		'option 2 does not work',
		"I can't do the second one",
		'none of those work for me',
		'not the first one',
	])('never reads %j as a pick', (text) => {
		expect(parseSlotChoice(text, 3)).toBeNull();
	});

	it('still books an affirmative pick containing no negation', () => {
		expect(parseSlotChoice('The first one works perfectly', 3)).toBe(0);
	});
});

describe('parseSlotChoice — #N is only a standalone pick', () => {
	it('reads a standalone "#2" but not an apartment number mid-sentence', () => {
		expect(parseSlotChoice('#2', 3)).toBe(1);
		expect(parseSlotChoice('#2 works', 3)).toBe(1);
		expect(parseSlotChoice("Tuesday works. I'm at 45 Main St #2.", 3)).toBeNull();
	});
});

describe('matchOfferedSlot — guards', () => {
	// Tuesday July 7th 9:00 AM and Thursday July 9th 2:00 PM, Pacific.
	const offered = [
		{ startAt: '2026-07-07T16:00:00.000Z', durationMinutes: 60 },
		{ startAt: '2026-07-09T21:00:00.000Z', durationMinutes: 60 },
	];

	it('refuses to match when the reply names an explicit date', () => {
		// "the 14th" is a different Tuesday than the offered July 7th.
		expect(matchOfferedSlot('Tuesday the 14th at 9am works', offered, PACIFIC)).toBeNull();
		expect(matchOfferedSlot('Tuesday July 14 at 9am', offered, PACIFIC)).toBeNull();
		expect(matchOfferedSlot('tuesday 2026-07-14 works', offered, PACIFIC)).toBeNull();
	});

	it('refuses to match a negated day or time', () => {
		expect(matchOfferedSlot("Tuesday doesn't work for me", offered, PACIFIC)).toBeNull();
		expect(matchOfferedSlot("2pm doesn't work", offered, PACIFIC)).toBeNull();
	});

	it('leaves a relative day + time to the proposal parser', () => {
		// It is Wednesday July 1st, so "tomorrow" is the 2nd — the offered Thursday
		// is the 9th, and its 2 PM is not the 2 PM being asked for.
		expect(matchOfferedSlot('tomorrow at 2pm', offered, PACIFIC)).toBeNull();
	});

	it.each([
		// The hour is on offer, but not in the week the reply is talking about.
		'next week at 2pm',
		'tuesday next week at 9am',
		'a week from thursday at 2pm',
		'in two weeks at 9am',
		'the following thursday at 2pm',
		// "this afternoon" is today; the offers are next week.
		'2pm this afternoon',
		// A reply asking to move the window names no window this matcher can check.
		'can we do it later?',
		'anything sooner? 9am',
	])('refuses to match %j, which shifts the window off the offers', (text) => {
		expect(matchOfferedSlot(text, offered, PACIFIC)).toBeNull();
	});

	it('still matches the ordinary "next"/"this" weekday forms', () => {
		// A determiner on a weekday is just how people write the coming one — only a
		// determiner on a week, month or part of a day shifts the window.
		expect(matchOfferedSlot('next thursday at 2pm', offered, PACIFIC)).toBe(1);
		expect(matchOfferedSlot('this tuesday at 9am', offered, PACIFIC)).toBe(0);
		// Minutes and hours are not shifted windows either.
		expect(matchOfferedSlot('in 20 mins can we do 2pm?', offered, PACIFIC)).toBe(1);
	});

	it.each([
		// A plain refusal, with no contraction to spot it by.
		'no, not 2pm',
		'not tuesday',
		// An exclusion frame names what is NOT wanted.
		'anything but 2pm',
	])('refuses to match the refusal in %j', (text) => {
		expect(matchOfferedSlot(text, offered, PACIFIC)).toBeNull();
	});

	it('keeps ordinary politeness affirmative', () => {
		// "no problem"/"no worries" are agreement, not refusal.
		expect(matchOfferedSlot('no problem, tuesday works', offered, PACIFIC)).toBe(0);
		expect(matchOfferedSlot('no worries — 2pm works', offered, PACIFIC)).toBe(1);
	});

	it.each([
		// A boundary is a request for what lies the other side of it: booking the
		// boundary itself answers the opposite of what was asked.
		'anything before 2pm',
		'until 2pm',
	])('refuses to book the boundary time in %j', (text) => {
		expect(matchOfferedSlot(text, offered, PACIFIC)).toBeNull();
	});

	it('still matches a time the reply merely approximates', () => {
		// "around 2pm" is satisfied by the 2 PM window itself, unlike "before 2pm".
		expect(matchOfferedSlot('around 2pm works', offered, PACIFIC)).toBe(1);
	});

	it('refuses to pick one of several times the reply listed', () => {
		expect(matchOfferedSlot('9am or 2pm works', offered, PACIFIC)).toBeNull();
		expect(matchOfferedSlot('tuesday at 9am or 2pm', offered, PACIFIC)).toBeNull();
	});

	it('counts one time named twice as one time', () => {
		expect(matchOfferedSlot('yes 2pm, 2pm!', offered, PACIFIC)).toBe(1);
		// Two spellings of 2:00 PM are still 2:00 PM.
		expect(matchOfferedSlot('2pm or 14:00', offered, PACIFIC)).toBe(1);
	});

	it('reads an hour a 12-hour clock does not have as no time at all', () => {
		expect(matchOfferedSlot('13am', offered, PACIFIC)).toBeNull();
	});

	it('refuses to match when the reply names a slashed date', () => {
		expect(matchOfferedSlot('8/5 at 2pm', offered, PACIFIC)).toBeNull();
		expect(matchOfferedSlot('tuesday 7/14 at 9am', offered, PACIFIC)).toBeNull();
	});

	it('still matches around the sizes and hours a trades inbox is full of', () => {
		// "1/2 inch" and "24/7" are not dates, and their digits are not hours.
		expect(matchOfferedSlot('1/2 inch pipe — tuesday at 9am works', offered, PACIFIC)).toBe(0);
		expect(matchOfferedSlot('we are reachable 24/7, tuesday 9am works', offered, PACIFIC)).toBe(0);
	});
});

describe('parseSlotChoice — ordinals need to name an offer', () => {
	it.each([
		'I need a second visit for the outdoor faucet',
		'first thing in the morning would be great',
		'my third request this month…',
	])('does not read a passing ordinal in %j as a pick', (text) => {
		expect(parseSlotChoice(text, 3)).toBeNull();
	});

	it('still reads explicit ordinal picks', () => {
		expect(parseSlotChoice('The second one works great, thanks!', 3)).toBe(1);
		expect(parseSlotChoice('the third option', 3)).toBe(2);
		expect(parseSlotChoice('first', 3)).toBe(0);
		expect(parseSlotChoice('second works', 3)).toBe(1);
	});
});

describe('isAcknowledgement', () => {
	it.each([
		'Confirmed!',
		'confirmed',
		'Confirmed, thanks!',
		'ok',
		'OK!',
		'Okay 👍',
		'k',
		'kk',
		'yes',
		'yep',
		'sure',
		'sounds good',
		'Sounds good, thanks!',
		'that works for me',
		'perfect',
		'Great, thanks!',
		'thank you',
		'thanks so much',
		'see you then',
		'Great — see you then!',
		'will do',
		'got it',
		'all set',
		"that's perfect, thank you!",
		'awesome, see you then',
		'Hi there, confirmed!',
		'no worries, thanks',
	])('reads %j as an acknowledgement', (text) => {
		expect(isAcknowledgement(text)).toBe(true);
	});

	it.each([
		// Genuine new scheduling asks must never read as a bare acknowledgement.
		'Actually I need a second visit too — what else is open?',
		'what else do you have?',
		'can we reschedule?',
		'do you have anything sooner?',
		'move it to Friday',
		'actually, cancel that please',
		'ok but what else is open?',
		'sounds good, but can you also do Monday?',
		'when is it again?',
		'thanks, what time was that?',
		// Not affirmations at all.
		'sounds terrible',
		'that does not work',
		'',
		'   ',
	])('does not read %j as an acknowledgement', (text) => {
		expect(isAcknowledgement(text)).toBe(false);
	});

	it.each([
		// Numeric scheduling content must survive normalization as an unrecognized
		// token, so a reply proposing a (here unparseable) date/time stays a real
		// scheduling turn rather than being discarded down to "works"/"ok".
		'10 works',
		'7/10 works',
		'ok 7/10',
		'2 works',
		'9 or 10 works',
		'how about the 10th',
	])('does not read numeric scheduling content in %j as an acknowledgement', (text) => {
		expect(isAcknowledgement(text)).toBe(false);
	});
});

describe('namesAdditionalVisit', () => {
	it.each([
		'Can I book another appointment for the upstairs bath?',
		'I need a second visit for the water heater',
		'could we add an additional booking next week',
		'we want a separate job for the rental unit',
		'can you fit one more appointment in?',
		'need an extra visit before the inspection',
		'can you also book me for the gutter cleaning?',
		'I also need someone for the furnace',
		'in addition to Thursday, can you do Friday at 2?',
		'keep both please',
		'I want to keep both appointments',
	])('reads %j as asking for an additional visit', (text) => {
		expect(namesAdditionalVisit(text)).toBe(true);
	});

	it.each([
		// Picks and confirmations — the words a numbered offer is full of.
		'2',
		'option 2 works',
		'the second one works',
		'second option please',
		'option 2 also works',
		// Asking for DIFFERENT windows for the same visit, not another visit.
		'can we do another time?',
		'is there another slot?',
		'do you have another option?',
		'any other day works too',
		// Reschedule asks — the intent this guard must never claim.
		'can we reschedule?',
		'move it to Friday',
		'can you reschedule that to 4pm instead?',
		// "also need/want" continuing into a move of the EXISTING booking —
		// reading these as an additional visit re-creates the double-booking.
		'I also need to reschedule my appointment',
		'I also want to change my appointment to Monday at 10am',
		'also need it moved to Friday',
		'thanks — also want my appointment pushed back an hour',
		'also need to cancel that visit',
		'',
	])('does not read %j as asking for an additional visit', (text) => {
		expect(namesAdditionalVisit(text)).toBe(false);
	});
});

describe('parseRequestedDay', () => {
	// NOW is Wednesday July 1st, so the next Thursday is the 2nd and the next
	// Wednesday is a whole week out.
	it.each([
		['next thursday', { year: 2026, month: 7, day: 2 }],
		['Thursday?', { year: 2026, month: 7, day: 2 }],
		['do you have anything on thursday', { year: 2026, month: 7, day: 2 }],
		['thurs', { year: 2026, month: 7, day: 2 }],
		['this friday', { year: 2026, month: 7, day: 3 }],
		['what about monday', { year: 2026, month: 7, day: 6 }],
	])('reads the day named in %j', (text, expected) => {
		expect(parseRequestedDay(text, CTX)).toEqual(expected);
	});

	it('reads a weekday asked on that same weekday as next week', () => {
		// It is Wednesday: "wednesday?" is about the 8th, not about today. Someone
		// who means today has the word "today".
		expect(parseRequestedDay('wednesday?', CTX)).toEqual({ year: 2026, month: 7, day: 8 });
		// Asked ON a Thursday, "thursday" is the following Thursday.
		const thursday = { timeZone: PACIFIC, now: new Date('2026-07-02T17:00:00.000Z') };
		expect(parseRequestedDay('thursday', thursday)).toEqual({ year: 2026, month: 7, day: 9 });
	});

	it('reads today and tomorrow as bare words', () => {
		expect(parseRequestedDay('anything today?', CTX)).toEqual({ year: 2026, month: 7, day: 1 });
		expect(parseRequestedDay('how about tomorrow', CTX)).toEqual({ year: 2026, month: 7, day: 2 });
	});

	it.each([
		'august 6',
		'aug 6th',
		'6 august',
		'6th of august',
		'august 6, 2026',
		'2026-08-06',
	])('reads the calendar date in %j', (text) => {
		expect(parseRequestedDay(text, CTX)).toEqual({ year: 2026, month: 8, day: 6 });
	});

	it('keeps an explicit year, and rolls a year-less date that already passed', () => {
		expect(parseRequestedDay('august 6, 2027', CTX)).toEqual({ year: 2027, month: 8, day: 6 });
		// It is July 2026, so "January 5" points at next January.
		expect(parseRequestedDay('january 5', CTX)).toEqual({ year: 2027, month: 1, day: 5 });
		// An explicit past date is kept in the past — the engine declines it with a reason.
		expect(parseRequestedDay('2026-06-01', CTX)).toEqual({ year: 2026, month: 6, day: 1 });
	});

	it('rejects impossible dates', () => {
		expect(parseRequestedDay('february 30', CTX)).toBeNull();
		expect(parseRequestedDay('2026-13-01', CTX)).toBeNull();
	});

	it('rolls a passed leap day to the next leap year, not to a phantom February 29', () => {
		// Asked in mid-2028 (a leap year, its February 29 already behind), the next
		// real February 29 is 2032 — a blind year + 1 would hand the engine
		// 2029-02-29, which Date.UTC quietly normalizes to March 1.
		const afterLeapDay = { timeZone: PACIFIC, now: new Date('2028-06-01T17:00:00.000Z') };
		expect(parseRequestedDay('february 29', afterLeapDay)).toEqual({
			year: 2032,
			month: 2,
			day: 29,
		});
	});

	it('never reads a negated day as a request', () => {
		expect(parseRequestedDay("thursday doesn't work", CTX)).toBeNull();
		expect(parseRequestedDay("I can't do thursday", CTX)).toBeNull();
		// …but the alternative half of the same message still names a day.
		expect(parseRequestedDay("thursday doesn't work, how about friday?", CTX)).toEqual({
			year: 2026,
			month: 7,
			day: 3,
		});
	});

	it.each([
		'can you fit me in?',
		'what are your hours?',
		'are you open 24/7?',
		'my sink is leaking',
		'',
	])('reads no day in %j', (text) => {
		expect(parseRequestedDay(text, CTX)).toBeNull();
	});

	it('never reads a day out of an ordinary word that merely starts like one', () => {
		// This parser reads EVERY turn, not just replies to an offer, so the loose
		// `sat[a-z]*` shorthand the offer matchers use would answer these with
		// appointment times for Friday, Sunday and Saturday.
		expect(parseRequestedDay('my friend recommended you', CTX)).toBeNull();
		expect(parseRequestedDay('I need a heater for my sunroom', CTX)).toBeNull();
		expect(parseRequestedDay('the satellite dish is loose', CTX)).toBeNull();
		expect(parseRequestedDay('my fridge is leaking', CTX)).toBeNull();
	});

	it('respects the account timezone when resolving a relative day', () => {
		// 2026-07-02T04:00Z is still July 1st in Pacific but already the 2nd in UTC.
		const late = new Date('2026-07-02T04:00:00.000Z');
		expect(parseRequestedDay('tomorrow', { timeZone: PACIFIC, now: late })).toEqual({
			year: 2026,
			month: 7,
			day: 2,
		});
		expect(parseRequestedDay('tomorrow', { timeZone: 'UTC', now: late })).toEqual({
			year: 2026,
			month: 7,
			day: 3,
		});
	});
});

describe('parseProposedTime — negated times are not proposals', () => {
	it.each([
		"I can't do Tuesday at 2",
		"July 10 at 2pm doesn't work for me",
		'we cannot make tomorrow at 9am',
	])('returns null for %j', (text) => {
		expect(parseProposedTime(text, CTX)).toBeNull();
	});

	it('still reads the alternative half of a rejection', () => {
		// It is Wednesday July 1st 10 AM, so "Wednesday at 3pm" is later today:
		// 3 PM PDT = 22:00 UTC (same next-occurrence rule as the positive tests).
		expect(parseProposedTime("Tuesday doesn't work, how about Wednesday at 3pm?", CTX)).toBe(
			'2026-07-01T22:00:00.000Z',
		);
		expect(parseProposedTime("I can't do the morning. Tomorrow at 3pm works.", CTX)).toBe(
			'2026-07-02T22:00:00.000Z',
		);
		// An em-dash separates the rejection from the alternative just like a comma.
		expect(parseProposedTime('none of those — July 10 at 2pm?', CTX)).toBe(
			'2026-07-10T21:00:00.000Z',
		);
		// A bare "no" refuses the pick, but the clause after it still proposes: the
		// comma splits them, and only the clause that says no is skipped.
		expect(parseProposedTime('no, tuesday at 2pm works', CTX)).toBe('2026-07-07T21:00:00.000Z');
	});
});

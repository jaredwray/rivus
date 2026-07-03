import type { AgentSlot } from '@rivus/core';
import { describe, expect, it } from 'vitest';
import { matchOfferedSlot, parseProposedTime, parseSlotChoice } from '../src/services/agent/parse';

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

	it('returns null without a weekday, or with nothing offered', () => {
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

	it('refuses to match a negated day', () => {
		expect(matchOfferedSlot("Tuesday doesn't work for me", offered, PACIFIC)).toBeNull();
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
	});
});

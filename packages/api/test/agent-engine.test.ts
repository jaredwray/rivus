import type { AgentSlot } from '@rivus/core';
import { describe, expect, it } from 'vitest';
import { decideScheduling } from '../src/services/agent/engine';
import type { BusyInterval } from '../src/services/agent/slots';
import { BOOKING_HORIZON_DAYS, SEARCH_WINDOW_DAYS, zonedParts } from '../src/services/agent/slots';

const PACIFIC = 'America/Los_Angeles';
// Wednesday July 1st 2026, 10:00 AM PDT.
const NOW = new Date('2026-07-01T17:00:00.000Z');

// Tuesday July 7th 9:00 AM and Thursday July 9th 2:00 PM, Pacific.
const OFFERED: AgentSlot[] = [
	{ startAt: '2026-07-07T16:00:00.000Z', durationMinutes: 60 },
	{ startAt: '2026-07-09T21:00:00.000Z', durationMinutes: 60 },
];

function decide(input: {
	customerKnown?: boolean;
	text?: string;
	offeredSlots?: AgentSlot[];
	busy?: BusyInterval[];
	now?: Date;
}) {
	return decideScheduling({
		customerKnown: input.customerKnown ?? true,
		text: input.text ?? '',
		offeredSlots: input.offeredSlots ?? [],
		busy: input.busy ?? [],
		timeZone: PACIFIC,
		now: input.now ?? NOW,
	});
}

describe('decideScheduling — sender validation', () => {
	it('always sends the signup link when the sender is not a customer', () => {
		expect(decide({ customerKnown: false, text: 'Can I book something?' })).toEqual({
			kind: 'send_signup_link',
		});
		// Even a message that names a perfect slot never books for a stranger.
		expect(decide({ customerKnown: false, text: 'July 10 at 2pm' })).toEqual({
			kind: 'send_signup_link',
		});
	});
});

describe('decideScheduling — first contact', () => {
	it('offers open slots to a customer with no pick and no proposal', () => {
		const decision = decide({ text: 'Hi! I need my water heater looked at.' });
		expect(decision.kind).toBe('offer_slots');
		if (decision.kind === 'offer_slots') {
			expect(decision.slots.length).toBeGreaterThan(0);
		}
	});

	it('reports no availability when the calendar is solid for the whole window', () => {
		const busy = [
			{ startAt: NOW.toISOString(), durationMinutes: (SEARCH_WINDOW_DAYS + 2) * 24 * 60 },
		];
		expect(decide({ text: 'my sink is leaking', busy })).toEqual({ kind: 'no_availability' });
	});
});

describe('decideScheduling — picking an offered slot', () => {
	it('books the picked slot when it is still free', () => {
		expect(decide({ text: 'option 2', offeredSlots: OFFERED })).toEqual({
			kind: 'book',
			slot: OFFERED[1],
		});
	});

	it('books a slot picked by naming its day', () => {
		expect(decide({ text: 'Tuesday works!', offeredSlots: OFFERED })).toEqual({
			kind: 'book',
			slot: OFFERED[0],
		});
	});

	it('offers alternatives when the picked slot was booked in the meantime', () => {
		const busy = [{ startAt: OFFERED[0]?.startAt ?? '', durationMinutes: 60 }];
		const decision = decide({ text: '1', offeredSlots: OFFERED, busy });
		expect(decision.kind).toBe('propose_unavailable');
		if (decision.kind === 'propose_unavailable') {
			expect(decision.reason).toBe('taken');
			expect(decision.requestedStartAt).toBe(OFFERED[0]?.startAt);
			expect(decision.alternatives.length).toBeGreaterThan(0);
			// The taken slot is not among the alternatives.
			expect(decision.alternatives.some((slot) => slot.startAt === OFFERED[0]?.startAt)).toBe(
				false,
			);
		}
	});

	it('treats a pick of a stale (already past) offer as unbookable', () => {
		// The thread sat idle for two weeks; the offered Tuesday is now in the past.
		const later = new Date('2026-07-20T17:00:00.000Z');
		const decision = decide({ text: '1', offeredSlots: OFFERED, now: later });
		expect(decision.kind).toBe('propose_unavailable');
		if (decision.kind === 'propose_unavailable') {
			expect(decision.reason).toBe('in_past');
		}
	});

	it('re-offers fresh slots when the reply picks nothing parseable', () => {
		const decision = decide({ text: 'hmm let me think…', offeredSlots: OFFERED });
		expect(decision.kind).toBe('offer_slots');
	});
});

describe('decideScheduling — picking an offered slot by its time', () => {
	// Thursday July 9th at 9:00 AM, 1:00 PM and 4:00 PM Pacific — the spread a
	// day-specific ask ("anything Thursday?") is answered with.
	const THURSDAY: AgentSlot[] = [
		{ startAt: '2026-07-09T16:00:00.000Z', durationMinutes: 60 },
		{ startAt: '2026-07-09T20:00:00.000Z', durationMinutes: 60 },
		{ startAt: '2026-07-09T23:00:00.000Z', durationMinutes: 60 },
	];

	it('books the 1 PM window when the reply only says "lets do 1pm"', () => {
		// The reported bug: three options from one day on the table, and a reply
		// naming one of them by time came back as another generic offer.
		expect(decide({ text: 'lets do 1pm', offeredSlots: THURSDAY })).toEqual({
			kind: 'book',
			slot: THURSDAY[1],
		});
	});

	it('books a bare time that matches exactly one offer across days', () => {
		expect(decide({ text: 'lets do 2pm', offeredSlots: OFFERED })).toEqual({
			kind: 'book',
			slot: OFFERED[1],
		});
	});

	it('re-checks the calendar before booking a slot picked by time', () => {
		const busy = [{ startAt: THURSDAY[1]?.startAt ?? '', durationMinutes: 60 }];
		const decision = decide({ text: 'lets do 1pm', offeredSlots: THURSDAY, busy });
		expect(decision.kind).toBe('propose_unavailable');
		if (decision.kind === 'propose_unavailable') {
			expect(decision.reason).toBe('taken');
			expect(decision.requestedStartAt).toBe(THURSDAY[1]?.startAt);
		}
	});

	it('re-offers instead of booking a time the reply moved to another week', () => {
		// "1pm next week" hour-matches the offered Thursday 1:00 PM, but it is not
		// the week being asked about — the safe answer is a fresh set of options.
		expect(decide({ text: '1pm next week', offeredSlots: THURSDAY }).kind).toBe('offer_slots');
	});

	it('re-offers instead of guessing which day a bare time meant', () => {
		// The same hour on two days: nothing in the reply says which one.
		const twoMornings: AgentSlot[] = [
			{ startAt: '2026-07-07T16:00:00.000Z', durationMinutes: 60 },
			{ startAt: '2026-07-08T16:00:00.000Z', durationMinutes: 60 },
		];
		expect(decide({ text: '9am', offeredSlots: twoMornings }).kind).toBe('offer_slots');
	});
});

describe('decideScheduling — customer proposes their own time', () => {
	it('books a free, in-hours proposal', () => {
		const decision = decide({ text: 'Could you do July 10 at 2pm?' });
		expect(decision).toEqual({
			kind: 'book',
			slot: { startAt: '2026-07-10T21:00:00.000Z', durationMinutes: 60 },
		});
	});

	it('books a same-day proposal (the 24h notice only paces offers, not explicit asks)', () => {
		expect(decide({ text: 'today at 3pm?' })).toEqual({
			kind: 'book',
			slot: { startAt: '2026-07-01T22:00:00.000Z', durationMinutes: 60 },
		});
	});

	it('declines a proposal outside business hours and offers what is open', () => {
		// Saturday July 4th at 10 AM.
		const decision = decide({ text: 'Saturday at 10am?' });
		expect(decision.kind).toBe('propose_unavailable');
		if (decision.kind === 'propose_unavailable') {
			expect(decision.reason).toBe('outside_hours');
			expect(decision.alternatives.length).toBeGreaterThan(0);
		}
	});

	it('declines an early-morning proposal as outside hours', () => {
		const decision = decide({ text: 'tomorrow at 8am' });
		expect(decision.kind).toBe('propose_unavailable');
		if (decision.kind === 'propose_unavailable') {
			expect(decision.reason).toBe('outside_hours');
		}
	});

	it('declines a proposal that collides with an existing booking', () => {
		const busy = [{ startAt: '2026-07-10T21:00:00.000Z', durationMinutes: 60 }];
		const decision = decide({ text: 'July 10 at 2pm', busy });
		expect(decision.kind).toBe('propose_unavailable');
		if (decision.kind === 'propose_unavailable') {
			expect(decision.reason).toBe('taken');
			expect(decision.requestedStartAt).toBe('2026-07-10T21:00:00.000Z');
		}
	});

	it('declines an explicitly past proposal with a reason', () => {
		const decision = decide({ text: '2026-06-01 09:00' });
		expect(decision.kind).toBe('propose_unavailable');
		if (decision.kind === 'propose_unavailable') {
			expect(decision.reason).toBe('in_past');
		}
	});

	it('books a proposal even when other slots were on offer', () => {
		// The customer ignores the offers and names their own (free) time.
		const decision = decide({ text: 'none of those — July 10 at 2pm?', offeredSlots: OFFERED });
		expect(decision).toEqual({
			kind: 'book',
			slot: { startAt: '2026-07-10T21:00:00.000Z', durationMinutes: 60 },
		});
	});
});

describe('decideScheduling — review-driven guards', () => {
	it('never books a slot the reply declines', () => {
		const decision = decide({
			text: "The first one doesn't work for me, sadly",
			offeredSlots: OFFERED,
		});
		expect(decision.kind).toBe('offer_slots');
	});

	it('re-offers instead of guessing when a reply names an unresolvable explicit date', () => {
		// Offered Tuesday is July 7th; the customer asks for Tuesday the 14th.
		const decision = decide({ text: 'Tuesday the 14th at 9am works', offeredSlots: OFFERED });
		expect(decision.kind).toBe('offer_slots');
	});

	it('declines a proposal beyond the booking horizon instead of double-booking blind', () => {
		const decision = decide({ text: '2026-10-15 10:00' });
		expect(decision.kind).toBe('propose_unavailable');
		if (decision.kind === 'propose_unavailable') {
			expect(decision.reason).toBe('beyond_horizon');
		}
	});

	it('treats a mention of the already-booked time as a confirmation, not a collision', () => {
		const bookedSlot = { startAt: '2026-07-07T16:00:00.000Z', durationMinutes: 60 };
		const decision = decideScheduling({
			customerKnown: true,
			text: 'Great, see you Tuesday at 9!',
			offeredSlots: [],
			// The booked job appears in busy like any other job.
			busy: [bookedSlot],
			timeZone: PACIFIC,
			now: NOW,
			bookedSlot,
		});
		expect(decision).toEqual({ kind: 'confirm_existing', slot: bookedSlot });
	});

	it('still declines a genuinely different taken time while booked', () => {
		const bookedSlot = { startAt: '2026-07-07T16:00:00.000Z', durationMinutes: 60 };
		const otherBusy = { startAt: '2026-07-08T16:00:00.000Z', durationMinutes: 60 };
		const decision = decideScheduling({
			customerKnown: true,
			text: 'Could you also do Wednesday at 9am?',
			offeredSlots: [],
			busy: [bookedSlot, otherBusy],
			timeZone: PACIFIC,
			now: NOW,
			bookedSlot,
		});
		expect(decision.kind).toBe('propose_unavailable');
		if (decision.kind === 'propose_unavailable') {
			expect(decision.reason).toBe('taken');
		}
	});
});

describe('decideScheduling — the customer asks about a whole day', () => {
	// Sunday August 2nd 2026, 5:34 PM Pacific — the reported bug's clock, where
	// "next Thursday" came back as Monday/Tuesday/Wednesday openings.
	const SUNDAY = new Date('2026-08-03T00:34:00.000Z');
	// Thursday August 6th, midnight to midnight Pacific.
	const THURSDAY_START = '2026-08-06T07:00:00.000Z';

	function decideOn(text: string, overrides: { busy?: BusyInterval[] } = {}) {
		return decide({ text, now: SUNDAY, busy: overrides.busy ?? [] });
	}

	it('answers a day-only ask with that day, not with the next three openings', () => {
		const decision = decideOn('Hi! What availability do you have next Thursday?');
		expect(decision.kind).toBe('offer_slots');
		if (decision.kind === 'offer_slots') {
			expect(decision.requestedDayStartAt).toBe(THURSDAY_START);
			expect(decision.slots.length).toBeGreaterThan(0);
			// Every option is on the Thursday they asked about.
			for (const slot of decision.slots) {
				const parts = zonedParts(new Date(slot.startAt), PACIFIC);
				expect({ year: parts.year, month: parts.month, day: parts.day }).toEqual({
					year: 2026,
					month: 8,
					day: 6,
				});
			}
		}
	});

	it('says the day is full and offers what is open when it is booked solid', () => {
		const busy = [{ startAt: THURSDAY_START, durationMinutes: 24 * 60 }];
		const decision = decideOn('anything thursday?', { busy });
		expect(decision.kind).toBe('day_unavailable');
		if (decision.kind === 'day_unavailable') {
			expect(decision.reason).toBe('full');
			expect(decision.requestedDayStartAt).toBe(THURSDAY_START);
			expect(decision.alternatives.length).toBeGreaterThan(0);
			// The alternatives are on other days — that Thursday has nothing left.
			for (const slot of decision.alternatives) {
				expect(zonedParts(new Date(slot.startAt), PACIFIC).day).not.toBe(6);
			}
		}
	});

	it('says the business is closed for a weekend day', () => {
		const decision = decideOn('saturday?');
		expect(decision.kind).toBe('day_unavailable');
		if (decision.kind === 'day_unavailable') {
			expect(decision.reason).toBe('closed');
			// Saturday August 8th, midnight Pacific.
			expect(decision.requestedDayStartAt).toBe('2026-08-08T07:00:00.000Z');
			expect(decision.alternatives.length).toBeGreaterThan(0);
		}
	});

	it('declines a day that has already passed', () => {
		const decision = decideOn('2026-06-01');
		expect(decision.kind).toBe('day_unavailable');
		if (decision.kind === 'day_unavailable') {
			expect(decision.reason).toBe('in_past');
		}
	});

	it('declines a day beyond the booking horizon instead of answering blind', () => {
		// December is well past the 60-day horizon the busy calendar was loaded for.
		const decision = decideOn('2026-12-01');
		expect(decision.kind).toBe('day_unavailable');
		if (decision.kind === 'day_unavailable') {
			expect(decision.reason).toBe('beyond_horizon');
		}
	});

	it('never offers an hour past the horizon, even on a day whose morning is inside it', () => {
		// Noon PDT on Thursday July 2nd + 60 days lands at noon on Monday August
		// 31st: the 31st's morning is bookable, its afternoon is past the horizon —
		// and an hour the proposal branch would decline must not be offered here.
		const noon = new Date('2026-07-02T19:00:00.000Z');
		const horizonMs = noon.getTime() + BOOKING_HORIZON_DAYS * 24 * 60 * 60_000;
		const decision = decide({ text: 'august 31', now: noon });
		expect(decision.kind).toBe('offer_slots');
		if (decision.kind === 'offer_slots') {
			expect(decision.slots.length).toBeGreaterThan(0);
			for (const slot of decision.slots) {
				expect(Date.parse(slot.startAt)).toBeLessThanOrEqual(horizonMs);
			}
		}
	});

	it('treats a day-only mention of the booked day as a confirmation', () => {
		// Thursday August 6th at 9:00 AM Pacific is already on the calendar.
		const bookedSlot = { startAt: '2026-08-06T16:00:00.000Z', durationMinutes: 60 };
		const decision = decideScheduling({
			customerKnown: true,
			text: 'see you thursday!',
			offeredSlots: [],
			busy: [bookedSlot],
			timeZone: PACIFIC,
			now: SUNDAY,
			bookedSlot,
		});
		expect(decision).toEqual({ kind: 'confirm_existing', slot: bookedSlot });
	});

	it('still opens a fresh round when a booked contact asks about another day', () => {
		const bookedSlot = { startAt: '2026-08-06T16:00:00.000Z', durationMinutes: 60 };
		const decision = decideScheduling({
			customerKnown: true,
			text: 'what about friday?',
			offeredSlots: [],
			busy: [bookedSlot],
			timeZone: PACIFIC,
			now: SUNDAY,
			bookedSlot,
		});
		expect(decision.kind).toBe('offer_slots');
		if (decision.kind === 'offer_slots') {
			// Friday August 7th, midnight Pacific.
			expect(decision.requestedDayStartAt).toBe('2026-08-07T07:00:00.000Z');
		}
	});

	it('scopes to the asked-about day when the offered slots are all on other days', () => {
		// Monday, Tuesday and Wednesday are on the table; the reply names Thursday,
		// so no offer matches and the day branch answers about Thursday instead.
		const offeredSlots: AgentSlot[] = [
			{ startAt: '2026-08-03T16:00:00.000Z', durationMinutes: 60 },
			{ startAt: '2026-08-04T16:00:00.000Z', durationMinutes: 60 },
			{ startAt: '2026-08-05T16:00:00.000Z', durationMinutes: 60 },
		];
		const decision = decide({ text: 'Thursday?', offeredSlots, now: SUNDAY });
		expect(decision.kind).toBe('offer_slots');
		if (decision.kind === 'offer_slots') {
			expect(decision.requestedDayStartAt).toBe(THURSDAY_START);
		}
	});

	it('leaves the older, sharper readings of a reply untouched', () => {
		// A pick of an offered day still books it — picking beats day-scoping.
		const offeredSlots: AgentSlot[] = [
			{ startAt: '2026-08-04T16:00:00.000Z', durationMinutes: 60 },
		];
		expect(decide({ text: 'Tuesday works!', offeredSlots, now: SUNDAY })).toEqual({
			kind: 'book',
			slot: offeredSlots[0],
		});
		// A day WITH a time is still a proposal, and books without a day-scoped offer.
		const proposal = decideOn('thursday at 2pm');
		expect(proposal).toEqual({
			kind: 'book',
			slot: { startAt: '2026-08-06T21:00:00.000Z', durationMinutes: 60 },
		});
		// A stranger is still gated on signup, whatever day they name.
		expect(decide({ customerKnown: false, text: 'next thursday?', now: SUNDAY })).toEqual({
			kind: 'send_signup_link',
		});
	});
});

describe('decideScheduling — a bare greeting', () => {
	it('greets back instead of pushing appointment times', () => {
		// The reported bug: a known customer's first "Hello" came back as three slots.
		expect(decide({ text: 'Hello' })).toEqual({ kind: 'greet' });
		expect(decide({ text: 'hi there!' })).toEqual({ kind: 'greet' });
	});

	it('re-offers instead of greeting while slots are on the table', () => {
		// They have options in front of them; restating those beats a bare hello.
		const decision = decide({ text: 'hello', offeredSlots: OFFERED });
		expect(decision.kind).toBe('offer_slots');
	});

	it('reassures the standing booking when a booked contact says hello', () => {
		const bookedSlot = { startAt: '2026-07-07T16:00:00.000Z', durationMinutes: 60 };
		const decision = decideScheduling({
			customerKnown: true,
			text: 'Hey!',
			offeredSlots: [],
			busy: [bookedSlot],
			timeZone: PACIFIC,
			now: NOW,
			bookedSlot,
		});
		expect(decision).toEqual({ kind: 'confirm_existing', slot: bookedSlot });
	});

	it('still offers times when the greeting carries a real request', () => {
		expect(decide({ text: 'hello, my sink is leaking' }).kind).toBe('offer_slots');
	});

	it('never greets a stranger — the signup gate comes first', () => {
		expect(decide({ customerKnown: false, text: 'Hello' })).toEqual({ kind: 'send_signup_link' });
	});
});

describe('decideScheduling — acknowledging a booking', () => {
	const bookedSlot = { startAt: '2026-07-07T16:00:00.000Z', durationMinutes: 60 };

	function decideBooked(text: string) {
		return decideScheduling({
			customerKnown: true,
			text,
			offeredSlots: [],
			busy: [bookedSlot],
			timeZone: PACIFIC,
			now: NOW,
			bookedSlot,
		});
	}

	it.each([
		'Confirmed!',
		'ok thanks!',
		'Sounds good, see you then!',
		'Perfect — thank you!',
	])('reassures the existing booking instead of re-offering for %j', (text) => {
		expect(decideBooked(text)).toEqual({ kind: 'confirm_existing', slot: bookedSlot });
	});

	it('still starts a fresh round when a booked contact asks for more times', () => {
		// A real new request is not an acknowledgement, so the booking doesn't
		// suppress it — the agent offers concrete openings again.
		const decision = decideBooked('Actually I need a second visit too — what else is open?');
		expect(decision.kind).toBe('offer_slots');
	});

	it('does not re-offer scheduling for a bare "ok" on a booked thread', () => {
		const decision = decideBooked('ok');
		expect(decision.kind).toBe('confirm_existing');
	});

	it('treats numeric scheduling content as a real turn, not an acknowledgement', () => {
		// "7/10 works" carries a date the time parser can't resolve; it must still
		// re-open scheduling rather than be swallowed into a booking reassurance.
		const decision = decideBooked('7/10 works');
		expect(decision.kind).toBe('offer_slots');
	});

	it('only reassures when a booking actually stands — a bare "ok" with no booking re-offers', () => {
		// No bookedSlot (e.g. the thread is still `slots_offered`): there is nothing
		// to confirm, so an unparseable reply keeps moving toward a booking.
		const decision = decideScheduling({
			customerKnown: true,
			text: 'ok',
			offeredSlots: OFFERED,
			busy: [],
			timeZone: PACIFIC,
			now: NOW,
			bookedSlot: null,
		});
		expect(decision.kind).toBe('offer_slots');
	});
});

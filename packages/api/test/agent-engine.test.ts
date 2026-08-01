import type { AgentSlot } from '@rivus/core';
import { describe, expect, it } from 'vitest';
import { decideScheduling } from '../src/services/agent/engine';
import type { BusyInterval } from '../src/services/agent/slots';
import { SEARCH_WINDOW_DAYS } from '../src/services/agent/slots';

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

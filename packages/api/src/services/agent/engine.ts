import type { AgentSlot, IsoDateString } from '@rivus/core';
import {
	isAcknowledgement,
	matchOfferedSlot,
	parseProposedTime,
	parseRequestedDay,
	parseSlotChoice,
} from './parse';
import { isPureGreeting } from './question';
import {
	BOOKING_HORIZON_DAYS,
	type BusyInterval,
	computeOpenSlots,
	computeOpenSlotsOnDay,
	instantForZonedTime,
	isSlotFree,
	isWithinBusinessHours,
	SLOT_DURATION_MINUTES,
	zonedParts,
} from './slots';

/**
 * The channel-agnostic scheduling policy: given what the contact just said and
 * where the thread stands, decide the agent's next move. Pure by design —
 * mirroring `services/inbox.ts` — so the whole state machine is unit-testable;
 * each channel (email today, SMS/WhatsApp later) supplies the I/O around it and
 * renders the decision in its own voice.
 *
 * {@link AgentDecision} is deliberately wider than this one engine: it is the
 * whole agent's move vocabulary, so every capability's decision flows through
 * the same composer and every channel renders it without a change. The kinds
 * {@link decideScheduling} never returns are marked as such below.
 */

export type AgentDecision =
	/** The sender isn't a customer yet — invite them to add themselves, then resume. */
	| { kind: 'send_signup_link' }
	/**
	 * Offer these open windows and wait for a pick. `requestedDayStartAt` is set
	 * when the offer answers a day-specific ask ("what do you have Thursday?"), so
	 * the composer can name the day instead of calling them "next openings".
	 */
	| { kind: 'offer_slots'; slots: AgentSlot[]; requestedDayStartAt?: IsoDateString }
	/** The contact chose a bookable window — book it and confirm. */
	| { kind: 'book'; slot: AgentSlot }
	/** They named the time they're already booked for — reassure, don't re-book. */
	| { kind: 'confirm_existing'; slot: AgentSlot }
	/** The window they asked for doesn't work; explain why and offer alternatives. */
	| {
			kind: 'propose_unavailable';
			reason: 'taken' | 'outside_hours' | 'in_past' | 'beyond_horizon';
			requestedStartAt: string;
			alternatives: AgentSlot[];
	  }
	/** The day they asked about has nothing to offer; say why and offer what is open. */
	| {
			kind: 'day_unavailable';
			reason: 'full' | 'closed' | 'in_past' | 'beyond_horizon';
			requestedDayStartAt: IsoDateString;
			alternatives: AgentSlot[];
	  }
	/** Nothing is open in the search window — ask them to propose a time. */
	| { kind: 'no_availability' }
	/** They only said hello — say hello back and ask what they need. */
	| { kind: 'greet' }
	/**
	 * Not from this engine — the knowledge capability's move: the question was
	 * answered from the account's published knowledge base. `offeredSlots` carries
	 * a standing offer the question interrupted (empty when there is none), which
	 * the reply re-lists unchanged so the numbering the contact was given still
	 * picks the same window. `customerKnown` is false for a contact with no CRM
	 * record, who is answered *and* pointed at self-signup.
	 */
	| { kind: 'answer_question'; answer: string; offeredSlots: AgentSlot[]; customerKnown: boolean }
	/**
	 * Not from this engine — the knowledge capability's move: the knowledge base
	 * can't answer this (or the caution policy says a human should), so the agent
	 * says so and the conversation is flagged for the team.
	 */
	| { kind: 'hold_for_team' };

export interface SchedulingDecisionInput {
	/** Whether the sender resolved to a CRM customer. */
	customerKnown: boolean;
	/** The contact's message, as plain text. */
	text: string;
	/** Slots currently on offer (empty unless the thread is in `slots_offered`). */
	offeredSlots: AgentSlot[];
	/** Booked (non-canceled) windows on the account calendar. */
	busy: BusyInterval[];
	/** The account's IANA zone (already validated via `safeTimeZone`). */
	timeZone: string;
	/** The current instant — injected so tests are deterministic. */
	now: Date;
	/**
	 * The window already booked on this thread (when its job is still upcoming),
	 * so "great, see you Tuesday at 9!" reads as a confirmation of that booking
	 * rather than a new proposal colliding with it.
	 */
	bookedSlot?: AgentSlot | null;
}

/**
 * Decide the agent's next scheduling move.
 *
 * - An unrecognized sender is always pointed at self-signup first; scheduling
 *   only ever books against a real CRM customer.
 * - A reply that picks an offered slot books it — after re-checking the
 *   calendar, since the slot was computed when it was offered and the team may
 *   have booked over it since.
 * - A reply proposing its own time books it when it's inside business hours
 *   and free; otherwise the agent says why not and offers what *is* open.
 * - A reply naming only a day ("what do you have Thursday?") is answered about
 *   THAT day — the openings on it, or why it has none — instead of with the
 *   generic next openings, which is what makes the agent look like it read the
 *   question.
 * - Once a job is booked, a reply that merely acknowledges it ("Confirmed!",
 *   "thanks, see you then") reassures the existing booking rather than reopening
 *   scheduling — only a genuine new request starts another round.
 * - Anything else (first contact, small talk, an unparseable pick) gets
 *   concrete openings — the agent always moves the exchange toward a booking.
 */
export function decideScheduling(input: SchedulingDecisionInput): AgentDecision {
	if (!input.customerKnown) {
		return { kind: 'send_signup_link' };
	}

	const openSlots = () =>
		computeOpenSlots({ now: input.now, timeZone: input.timeZone, busy: input.busy });

	const chosen = pickOfferedSlot(input);
	if (chosen) {
		if (Date.parse(chosen.startAt) <= input.now.getTime()) {
			// A stale offer (the thread sat idle past the slot) can't be booked.
			return {
				kind: 'propose_unavailable',
				reason: 'in_past',
				requestedStartAt: chosen.startAt,
				alternatives: openSlots(),
			};
		}
		if (!isSlotFree(chosen, input.busy)) {
			return {
				kind: 'propose_unavailable',
				reason: 'taken',
				requestedStartAt: chosen.startAt,
				alternatives: openSlots(),
			};
		}
		return { kind: 'book', slot: chosen };
	}

	const proposedStartAt = parseProposedTime(input.text, {
		timeZone: input.timeZone,
		now: input.now,
	});
	if (proposedStartAt) {
		const slot: AgentSlot = { startAt: proposedStartAt, durationMinutes: SLOT_DURATION_MINUTES };
		// "See you Tuesday at 9!" after Tuesday 9 was booked on this very thread is
		// a confirmation, not a request — without this it would collide with the
		// customer's own job and be declined as "taken".
		if (input.bookedSlot && !isSlotFree(slot, [input.bookedSlot])) {
			return { kind: 'confirm_existing', slot: input.bookedSlot };
		}
		if (Date.parse(proposedStartAt) <= input.now.getTime()) {
			return {
				kind: 'propose_unavailable',
				reason: 'in_past',
				requestedStartAt: proposedStartAt,
				alternatives: openSlots(),
			};
		}
		// The conflict check only loaded jobs inside the horizon, so a time past
		// it must be declined, not checked against a calendar that isn't there.
		if (
			Date.parse(proposedStartAt) >
			input.now.getTime() + BOOKING_HORIZON_DAYS * 24 * 60 * 60_000
		) {
			return {
				kind: 'propose_unavailable',
				reason: 'beyond_horizon',
				requestedStartAt: proposedStartAt,
				alternatives: openSlots(),
			};
		}
		if (!isWithinBusinessHours(proposedStartAt, slot.durationMinutes, input.timeZone)) {
			return {
				kind: 'propose_unavailable',
				reason: 'outside_hours',
				requestedStartAt: proposedStartAt,
				alternatives: openSlots(),
			};
		}
		if (!isSlotFree(slot, input.busy)) {
			return {
				kind: 'propose_unavailable',
				reason: 'taken',
				requestedStartAt: proposedStartAt,
				alternatives: openSlots(),
			};
		}
		return { kind: 'book', slot };
	}

	// A day with no clock time on it ("next Thursday?", "anything on the 6th?")
	// is a question about that day. Answering it with the generic next openings
	// ignores the only thing the contact actually asked, so the day is looked at
	// directly. This runs after the proposal branch on purpose: a complete day +
	// time is a booking request and always wins.
	const requestedDay = parseRequestedDay(input.text, {
		timeZone: input.timeZone,
		now: input.now,
	});
	if (requestedDay) {
		const dayStart = instantForZonedTime(input.timeZone, {
			...requestedDay,
			hour: 0,
			minute: 0,
		});
		// The next local day's midnight — advanced on the (y, m, d) triple rather
		// than by adding 24 hours, because a DST day is not 24 hours long.
		const nextDay = new Date(
			Date.UTC(requestedDay.year, requestedDay.month - 1, requestedDay.day + 1),
		);
		const dayEnd = instantForZonedTime(input.timeZone, {
			year: nextDay.getUTCFullYear(),
			month: nextDay.getUTCMonth() + 1,
			day: nextDay.getUTCDate(),
			hour: 0,
			minute: 0,
		});
		// "See you Thursday!" about the Thursday already booked on this thread is a
		// confirmation, not a new ask — the same reasoning as the proposal branch's
		// booked-slot guard, one day wide instead of one hour.
		if (input.bookedSlot) {
			const booked = zonedParts(new Date(input.bookedSlot.startAt), input.timeZone);
			if (
				booked.year === requestedDay.year &&
				booked.month === requestedDay.month &&
				booked.day === requestedDay.day
			) {
				return { kind: 'confirm_existing', slot: input.bookedSlot };
			}
		}
		if (dayEnd.getTime() <= input.now.getTime()) {
			return {
				kind: 'day_unavailable',
				reason: 'in_past',
				requestedDayStartAt: dayStart.toISOString(),
				alternatives: openSlots(),
			};
		}
		// Only the calendar inside the horizon was loaded, so a day past it is
		// declined rather than reported open against jobs that were never fetched.
		if (dayStart.getTime() > input.now.getTime() + BOOKING_HORIZON_DAYS * 24 * 60 * 60_000) {
			return {
				kind: 'day_unavailable',
				reason: 'beyond_horizon',
				requestedDayStartAt: dayStart.toISOString(),
				alternatives: openSlots(),
			};
		}
		const weekday = zonedParts(dayStart, input.timeZone).weekday;
		if (weekday === 0 || weekday === 6) {
			return {
				kind: 'day_unavailable',
				reason: 'closed',
				requestedDayStartAt: dayStart.toISOString(),
				alternatives: openSlots(),
			};
		}
		const daySlots = computeOpenSlotsOnDay({
			now: input.now,
			timeZone: input.timeZone,
			busy: input.busy,
			day: requestedDay,
		});
		if (daySlots.length > 0) {
			return {
				kind: 'offer_slots',
				slots: daySlots,
				requestedDayStartAt: dayStart.toISOString(),
			};
		}
		return {
			kind: 'day_unavailable',
			reason: 'full',
			requestedDayStartAt: dayStart.toISOString(),
			alternatives: openSlots(),
		};
	}

	// Once a job is booked, a reply that only acknowledges it ("Confirmed!",
	// "sounds good, thanks", "great — see you then!") must not reopen scheduling.
	// Reassure the standing booking instead of offering fresh times. A genuine new
	// ask ("what else is open?") is not an acknowledgement and still falls through
	// to a fresh offer below, so a booked thread can still start another round.
	if (input.bookedSlot && isAcknowledgement(input.text)) {
		return { kind: 'confirm_existing', slot: input.bookedSlot };
	}

	// Someone who has only said "hello" hasn't asked for anything yet, and meeting
	// that with three appointment times reads as an agent that isn't listening.
	// Two exceptions, both about not losing context the contact already has: on a
	// booked thread a "hi" reassures the booking (same reasoning as the
	// acknowledgement above), and while slots are on offer re-listing them is more
	// useful than a bare hello.
	if (isPureGreeting(input.text)) {
		if (input.bookedSlot) {
			return { kind: 'confirm_existing', slot: input.bookedSlot };
		}
		if (input.offeredSlots.length === 0) {
			return { kind: 'greet' };
		}
	}

	const slots = openSlots();
	if (slots.length === 0) {
		return { kind: 'no_availability' };
	}
	return { kind: 'offer_slots', slots };
}

/** The offered slot the reply picks — by number/ordinal, or by naming its day. */
function pickOfferedSlot(input: SchedulingDecisionInput): AgentSlot | null {
	if (input.offeredSlots.length === 0) {
		return null;
	}
	const byNumber = parseSlotChoice(input.text, input.offeredSlots.length);
	if (byNumber !== null) {
		return input.offeredSlots[byNumber] ?? null;
	}
	const byDay = matchOfferedSlot(input.text, input.offeredSlots, input.timeZone);
	if (byDay !== null) {
		return input.offeredSlots[byDay] ?? null;
	}
	return null;
}

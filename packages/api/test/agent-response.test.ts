import { describe, expect, it } from 'vitest';
import type { AgentDecision } from '../src/services/agent/engine';
import {
	type AgentReplyContext,
	type ChannelMedium,
	composeAgentResponse,
	freeTextResponse,
	renderResponseText,
} from '../src/services/agent/response';

/**
 * The core `AgentDecision → AgentResponse` composer. This is the single place
 * decision kinds become content (the switch that used to live in each channel's
 * templates), so covering every kind here is what lets every channel render every
 * decision without its own per-kind logic.
 */

const NOW = new Date('2026-07-03T17:00:00.000Z');

function context(overrides: Partial<AgentReplyContext> = {}): AgentReplyContext {
	return {
		accountName: 'Cascade Plumbing',
		customerName: 'Dana Fox',
		timeZone: 'America/Los_Angeles',
		signupUrl: 'https://www.rivus.ai/customers/join/cascade-plumbing?email=d%40x.io',
		jobTitle: 'Water heater install',
		now: NOW,
		medium: 'email',
		...overrides,
	};
}

const SLOT_A = { startAt: '2026-07-07T16:00:00.000Z', durationMinutes: 60 };
const SLOT_B = { startAt: '2026-07-09T21:00:00.000Z', durationMinutes: 60 };
const SLOTS = [SLOT_A, SLOT_B];
const ANSWER = "We're open Monday through Friday, 9:00 AM to 5:00 PM.";
/** Midnight Pacific on Tuesday July 7th — a whole day, as the engine names one. */
const DAY_START = '2026-07-07T07:00:00.000Z';
/** Appointments the contact already has, as a status answer names them. */
const BOOKING_A = { title: 'Water heater install', startAt: SLOT_A.startAt, durationMinutes: 60 };
const BOOKING_B = { title: 'Annual service', startAt: SLOT_B.startAt, durationMinutes: 90 };
const BOOKINGS = [BOOKING_A, BOOKING_B];

/** Every decision kind, with a representative payload. */
const DECISIONS: AgentDecision[] = [
	{ kind: 'send_signup_link' },
	{ kind: 'offer_slots', slots: SLOTS },
	{ kind: 'offer_slots', slots: SLOTS, requestedDayStartAt: DAY_START },
	{ kind: 'day_unavailable', reason: 'full', requestedDayStartAt: DAY_START, alternatives: SLOTS },
	{ kind: 'day_unavailable', reason: 'closed', requestedDayStartAt: DAY_START, alternatives: [] },
	{ kind: 'book', slot: SLOT_A },
	{ kind: 'confirm_existing', slot: SLOT_A },
	{
		kind: 'propose_unavailable',
		reason: 'taken',
		requestedStartAt: SLOT_A.startAt,
		alternatives: SLOTS,
	},
	{
		kind: 'propose_unavailable',
		reason: 'outside_hours',
		requestedStartAt: SLOT_A.startAt,
		alternatives: [],
	},
	{ kind: 'no_availability' },
	{ kind: 'greet' },
	{ kind: 'answer_question', answer: ANSWER, offeredSlots: [], customerKnown: true },
	{ kind: 'answer_question', answer: ANSWER, offeredSlots: SLOTS, customerKnown: true },
	{ kind: 'answer_question', answer: ANSWER, offeredSlots: [], customerKnown: false },
	{ kind: 'hold_for_team' },
	{ kind: 'booking_status', bookings: [BOOKING_A], more: false, offeredSlots: [] },
	{ kind: 'booking_status', bookings: BOOKINGS, more: true, offeredSlots: SLOTS },
	{ kind: 'no_booking', alternatives: SLOTS },
	{ kind: 'no_booking', alternatives: [] },
];

describe('composeAgentResponse', () => {
	it('always opens with a greeting block naming the customer', () => {
		for (const decision of DECISIONS) {
			const [first] = composeAgentResponse(decision, context()).blocks;
			expect(first).toEqual({ kind: 'greeting', text: 'Hi Dana,' });
		}
	});

	it('greets an unrecognized contact generically', () => {
		const [first] = composeAgentResponse(
			{ kind: 'send_signup_link' },
			context({ customerName: '' }),
		).blocks;
		expect(first).toEqual({ kind: 'greeting', text: 'Hi there,' });
	});

	it('renders offered slots as an options block with 1-based values', () => {
		const response = composeAgentResponse({ kind: 'offer_slots', slots: SLOTS }, context());
		const options = response.blocks.find((block) => block.kind === 'options');
		expect(options).toBeDefined();
		expect(options?.kind === 'options' && options.items.map((item) => item.value)).toEqual([
			'1',
			'2',
		]);
	});

	it('renders the signup link as an action block', () => {
		const response = composeAgentResponse({ kind: 'send_signup_link' }, context());
		const action = response.blocks.find((block) => block.kind === 'action');
		expect(action).toEqual({
			kind: 'action',
			label: 'Join Cascade Plumbing as a customer',
			url: context().signupUrl,
		});
	});

	it('words the reply prompt for the medium', () => {
		const email = renderResponseText(
			composeAgentResponse({ kind: 'send_signup_link' }, context({ medium: 'email' })),
		);
		const chat = renderResponseText(
			composeAgentResponse({ kind: 'send_signup_link' }, context({ medium: 'chat' })),
		);
		expect(email).toContain('reply to this email');
		expect(chat).toContain('reply here');
		expect(chat).not.toContain('reply to this email');
	});

	it('produces non-empty, decision-appropriate text for every kind', () => {
		expect(
			renderResponseText(composeAgentResponse({ kind: 'book', slot: SLOT_A }, context())),
		).toContain("You're booked!");
		expect(
			renderResponseText(composeAgentResponse({ kind: 'no_availability' }, context())),
		).toContain('fully booked');
		expect(
			renderResponseText(
				composeAgentResponse(
					{
						kind: 'propose_unavailable',
						reason: 'in_past',
						requestedStartAt: SLOT_A.startAt,
						alternatives: [],
					},
					context(),
				),
			),
		).toContain('already passed');
		for (const decision of DECISIONS) {
			for (const medium of ['email', 'chat', 'voice'] as ChannelMedium[]) {
				const text = renderResponseText(composeAgentResponse(decision, context({ medium })));
				expect(text.trim().length).toBeGreaterThan(0);
			}
		}
	});
});

describe('composeAgentResponse — answering a question', () => {
	function answer(overrides: Partial<Extract<AgentDecision, { kind: 'answer_question' }>> = {}) {
		return {
			kind: 'answer_question' as const,
			answer: ANSWER,
			offeredSlots: [],
			customerKnown: true,
			...overrides,
		};
	}

	it('leads with the grounded answer and invites a booking, without inventing slots', () => {
		const response = composeAgentResponse(answer(), context());
		expect(response.blocks.map((block) => block.kind)).toEqual(['greeting', 'paragraph', 'notice']);
		const text = renderResponseText(response);
		expect(text).toContain(ANSWER);
		expect(text).toContain('Want to book a time?');
	});

	it('restates a standing offer with the same slots in the same order', () => {
		const response = composeAgentResponse(answer({ offeredSlots: SLOTS }), context());
		const options = response.blocks.find((block) => block.kind === 'options');
		expect(options?.kind === 'options' && options.items.map((item) => item.value)).toEqual([
			'1',
			'2',
		]);
		const text = renderResponseText(response);
		expect(text).toContain(ANSWER);
		expect(text).toContain('The times I offered are still open:');
		expect(text).toContain('Reply with the number that works for you');
	});

	it('answers an unrecognized contact and still hands them the signup link', () => {
		const response = composeAgentResponse(answer({ customerKnown: false }), context());
		expect(response.blocks.find((block) => block.kind === 'action')).toEqual({
			kind: 'action',
			label: 'Join Cascade Plumbing as a customer',
			url: context().signupUrl,
		});
		expect(renderResponseText(response)).toContain(ANSWER);
	});

	it('words the follow-up for the medium', () => {
		const email = renderResponseText(composeAgentResponse(answer(), context()));
		const chat = renderResponseText(composeAgentResponse(answer(), context({ medium: 'chat' })));
		const voice = renderResponseText(composeAgentResponse(answer(), context({ medium: 'voice' })));
		expect(email).toContain('reply to this email');
		expect(chat).toContain('reply here');
		// A caller is still on the line, so they are never told to call back.
		expect(voice).toContain('say the word');
		expect(voice).not.toContain('reply');
		expect(voice).not.toContain('call back');
	});

	it('keeps the signup wording spoken-friendly for a caller', () => {
		const voice = renderResponseText(
			composeAgentResponse(answer({ customerKnown: false }), context({ medium: 'voice' })),
		);
		expect(voice).toContain("web link I'll read out");
	});
});

describe('composeAgentResponse — an ask about one day', () => {
	it('names the day an offer answers, instead of calling it "next openings"', () => {
		const text = renderResponseText(
			composeAgentResponse(
				{ kind: 'offer_slots', slots: SLOTS, requestedDayStartAt: DAY_START },
				context(),
			),
		);
		expect(text).toContain('Here is what Cascade Plumbing has open on Tuesday, July 7:');
		expect(text).not.toContain('next openings');
		expect(text).toContain('1. Tuesday, July 7 at 9:00 AM');
		expect(text).toContain('Reply with the number that works for you');
	});

	it('still leads with the generic openings when no day was asked about', () => {
		const text = renderResponseText(
			composeAgentResponse({ kind: 'offer_slots', slots: SLOTS }, context()),
		);
		expect(text).toContain("Here are Cascade Plumbing's next openings:");
		expect(text).not.toContain('has open on');
	});

	function unavailable(
		reason: 'full' | 'closed' | 'in_past' | 'beyond_horizon',
		overrides: { requestedDayStartAt?: string; alternatives?: typeof SLOTS } = {},
	) {
		return renderResponseText(
			composeAgentResponse(
				{
					kind: 'day_unavailable',
					reason,
					requestedDayStartAt: overrides.requestedDayStartAt ?? DAY_START,
					alternatives: overrides.alternatives ?? [],
				},
				context(),
			),
		);
	}

	it('gives each reason its own sentence about the named day', () => {
		expect(unavailable('full')).toContain(
			"Unfortunately I don't have anything open on Tuesday, July 7.",
		);
		// Midnight Pacific on Saturday July 4th.
		expect(unavailable('closed', { requestedDayStartAt: '2026-07-04T07:00:00.000Z' })).toContain(
			"Unfortunately we're closed on Saturday, July 4 — our hours are Monday to Friday, 9:00 AM to 5:00 PM.",
		);
		expect(unavailable('in_past')).toContain('Unfortunately Tuesday, July 7 has already passed.');
		expect(unavailable('beyond_horizon')).toContain(
			'Unfortunately Tuesday, July 7 is further out than I can schedule right now — I can book up to about two months ahead.',
		);
	});

	it('offers the alternatives it does have, numbered and pickable', () => {
		const text = unavailable('full', { alternatives: SLOTS });
		expect(text).toContain('Here is what we do have open:');
		expect(text).toContain('1. Tuesday, July 7 at 9:00 AM');
		expect(text).toContain('2. Thursday, July 9 at 2:00 PM');
		expect(text).toContain('Reply with the number that works for you');
	});

	it('asks for times when it has no alternatives at all', () => {
		const text = unavailable('full');
		expect(text).not.toContain('Here is what we do have open:');
		expect(text).toContain("I couldn't find another opening in the next two weeks");
		expect(text).toContain("check them against Cascade Plumbing's calendar");
	});

	it('spells out the year on a day that falls outside this one', () => {
		// Midnight Pacific on Friday January 1st 2027, asked in July 2026.
		const text = unavailable('closed', { requestedDayStartAt: '2027-01-01T08:00:00.000Z' });
		expect(text).toContain("we're closed on Friday, January 1, 2027");
	});
});

describe('composeAgentResponse — greeting and holding', () => {
	it('answers a bare greeting with an offer to help, not with appointment times', () => {
		const response = composeAgentResponse({ kind: 'greet' }, context());
		expect(response.blocks.some((block) => block.kind === 'options')).toBe(false);
		const text = renderResponseText(response);
		expect(text).toContain("I'm Rivus");
		expect(text).toContain('book you an appointment or answer questions');
		expect(text).toContain('reply to this email');
	});

	it('speaks the greeting prompt aloud on voice', () => {
		const text = renderResponseText(
			composeAgentResponse({ kind: 'greet' }, context({ medium: 'voice' })),
		);
		expect(text).toContain('Just tell me what you need.');
	});

	it('hands a held question to the team with no slots attached', () => {
		const response = composeAgentResponse({ kind: 'hold_for_team' }, context());
		expect(response.blocks.some((block) => block.kind === 'options')).toBe(false);
		const text = renderResponseText(response);
		expect(text).toContain('passed it to the Cascade Plumbing team');
		expect(text).toContain('reply to this email');
	});

	it('tells a caller to call back rather than reply', () => {
		const text = renderResponseText(
			composeAgentResponse({ kind: 'hold_for_team' }, context({ medium: 'voice' })),
		);
		expect(text).toContain('call back');
		expect(text).not.toContain('reply');
	});
});

describe('composeAgentResponse — what the contact already has booked', () => {
	it('names the service and the time, the same way a fresh booking is confirmed', () => {
		const text = renderResponseText(
			composeAgentResponse(
				{ kind: 'booking_status', bookings: [BOOKING_A], more: false, offeredSlots: [] },
				context(),
			),
		);
		expect(text).toContain("Here's what you have coming up with Cascade Plumbing:");
		expect(text).toContain('Water heater install — Tuesday, July 7 at 9:00 AM (60 minutes).');
		expect(text).toContain('If you need to change or cancel, just reply and let me know.');
	});

	it('never renders bookings as pickable options — they are not choices', () => {
		const response = composeAgentResponse(
			{ kind: 'booking_status', bookings: BOOKINGS, more: false, offeredSlots: [] },
			context(),
		);
		expect(response.blocks.some((block) => block.kind === 'options')).toBe(false);
		const text = renderResponseText(response);
		expect(text).toContain('Water heater install — Tuesday, July 7 at 9:00 AM (60 minutes).');
		expect(text).toContain('Annual service — Thursday, July 9 at 2:00 PM (90 minutes).');
	});

	it('says so when the calendar holds more than the reply lists', () => {
		const capped = renderResponseText(
			composeAgentResponse(
				{ kind: 'booking_status', bookings: BOOKINGS, more: true, offeredSlots: [] },
				context(),
			),
		);
		expect(capped).toContain("Those are the next 2 — reply to this email if you'd like the rest.");
		const complete = renderResponseText(
			composeAgentResponse(
				{ kind: 'booking_status', bookings: BOOKINGS, more: false, offeredSlots: [] },
				context(),
			),
		);
		expect(complete).not.toContain('Those are the next');
	});

	it('restates a standing offer, so a question does not cost the contact their options', () => {
		const response = composeAgentResponse(
			{ kind: 'booking_status', bookings: [BOOKING_A], more: false, offeredSlots: SLOTS },
			context(),
		);
		const options = response.blocks.find((block) => block.kind === 'options');
		expect(options?.kind === 'options' && options.items.map((item) => item.value)).toEqual([
			'1',
			'2',
		]);
		const text = renderResponseText(response);
		expect(text).toContain('Water heater install — Tuesday, July 7 at 9:00 AM (60 minutes).');
		expect(text).toContain('The times I offered are still open:');
		expect(text).toContain('Reply with the number that works for you');
	});

	it('tells a caller to call back rather than reply', () => {
		const text = renderResponseText(
			composeAgentResponse(
				{ kind: 'booking_status', bookings: [BOOKING_A], more: false, offeredSlots: [] },
				context({ medium: 'voice' }),
			),
		);
		expect(text).toContain('If you need to change or cancel, just call back anytime.');
		expect(text).not.toContain('reply');
	});

	it('spells out the year on a booking that falls outside this one', () => {
		const text = renderResponseText(
			composeAgentResponse(
				{
					kind: 'booking_status',
					bookings: [{ ...BOOKING_A, startAt: '2027-01-04T17:00:00.000Z' }],
					more: false,
					offeredSlots: [],
				},
				context(),
			),
		);
		expect(text).toContain('Monday, January 4, 2027 at 9:00 AM');
	});
});

describe('composeAgentResponse — nothing on the calendar for them', () => {
	it('says plainly that nothing is booked, then offers what is open', () => {
		const response = composeAgentResponse({ kind: 'no_booking', alternatives: SLOTS }, context());
		const text = renderResponseText(response);
		expect(text).toContain("I don't see anything booked for you with Cascade Plumbing right now.");
		expect(text).toContain('Here is what we do have open:');
		expect(text).toContain('1. Tuesday, July 7 at 9:00 AM');
		expect(text).toContain('Reply with the number that works for you');
	});

	it('asks for times when there is nothing booked and nothing open either', () => {
		const text = renderResponseText(
			composeAgentResponse({ kind: 'no_booking', alternatives: [] }, context()),
		);
		expect(text).toContain("I don't see anything booked for you with Cascade Plumbing right now.");
		expect(text).toContain("I couldn't find an opening in the next two weeks either.");
		expect(text).toContain(
			"Reply with a few times that work for you and I'll check them against the calendar.",
		);
	});
});

describe('freeTextResponse + renderResponseText', () => {
	it('round-trips a free-text body verbatim', () => {
		const body = 'Hi Dana,\n\nWe can be there at noon.\n— Sam';
		expect(renderResponseText(freeTextResponse(body))).toBe(body);
	});
});

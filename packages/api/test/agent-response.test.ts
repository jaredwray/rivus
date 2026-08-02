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

/** Every decision kind, with a representative payload. */
const DECISIONS: AgentDecision[] = [
	{ kind: 'send_signup_link' },
	{ kind: 'offer_slots', slots: SLOTS },
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

describe('freeTextResponse + renderResponseText', () => {
	it('round-trips a free-text body verbatim', () => {
		const body = 'Hi Dana,\n\nWe can be there at noon.\n— Sam';
		expect(renderResponseText(freeTextResponse(body))).toBe(body);
	});
});

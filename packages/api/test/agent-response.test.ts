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

describe('freeTextResponse + renderResponseText', () => {
	it('round-trips a free-text body verbatim', () => {
		const body = 'Hi Dana,\n\nWe can be there at noon.\n— Sam';
		expect(renderResponseText(freeTextResponse(body))).toBe(body);
	});
});

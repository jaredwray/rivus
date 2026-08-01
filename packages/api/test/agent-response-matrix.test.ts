import type { Account, AccountId, AgentThread, AgentThreadId, ConversationId } from '@rivus/core';
import { emptyAccountChannels } from '@rivus/core';
import { describe, expect, it } from 'vitest';
import { createInMemoryRepositories } from '../src/repositories/memory';
import type { ChannelAdapter } from '../src/services/agent/channel';
import { createEmailChannelAdapter } from '../src/services/agent/email/adapter';
import type { AgentDecision } from '../src/services/agent/engine';
import { type AgentReplyContext, composeAgentResponse } from '../src/services/agent/response';
import { createSmsChannelAdapter } from '../src/services/agent/sms/adapter';
import { createVoiceChannelAdapter } from '../src/services/agent/voice/adapter';
import { createWhatsappChannelAdapter } from '../src/services/agent/whatsapp/adapter';
import type { AgentEmail, Mailer } from '../src/services/email';
import { RecordingSmsSender, RecordingWhatsappSender } from './helpers';

/**
 * The invariant that makes "a core feature ships on every channel" structural:
 * every registered channel adapter must render EVERY agent decision into a
 * non-empty message and a non-empty transcript line. A future decision kind a
 * channel can't render fails here — for that channel, in one run — long before it
 * could silently go missing in production. (The block-kind switches in each
 * renderer are also TypeScript-exhaustive, so a new block kind is a compile error
 * in every renderer first.) When a channel is added, it joins the `CHANNELS`
 * list below and is covered automatically.
 */

const SLOT_A = { startAt: '2026-07-07T16:00:00.000Z', durationMinutes: 60 };
const SLOT_B = { startAt: '2026-07-09T21:00:00.000Z', durationMinutes: 60 };
const SLOTS = [SLOT_A, SLOT_B];
const ANSWER = "We're open Monday through Friday, 9:00 AM to 5:00 PM.";

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
		reason: 'beyond_horizon',
		requestedStartAt: SLOT_A.startAt,
		alternatives: [],
	},
	{ kind: 'no_availability' },
	{ kind: 'greet' },
	// The knowledge capability's kinds, in each shape that renders differently: a
	// bare answer, an answer that restates a standing offer, and an answer that also
	// has to carry the signup call-to-action.
	{ kind: 'answer_question', answer: ANSWER, offeredSlots: [], customerKnown: true },
	{ kind: 'answer_question', answer: ANSWER, offeredSlots: SLOTS, customerKnown: true },
	{ kind: 'answer_question', answer: ANSWER, offeredSlots: [], customerKnown: false },
	{ kind: 'hold_for_team' },
];

/** A distinct test name per decision, so the variants of one kind don't collide. */
function decisionLabel(decision: AgentDecision): string {
	if (decision.kind === 'propose_unavailable') {
		return `${decision.kind}:${decision.reason}:${decision.alternatives.length ? 'alt' : 'none'}`;
	}
	if (decision.kind === 'answer_question') {
		const offer = decision.offeredSlots.length > 0 ? 'offer' : 'none';
		return `${decision.kind}:${offer}:${decision.customerKnown ? 'known' : 'unknown'}`;
	}
	return decision.kind;
}

/** A mailer that records the last agent email it was asked to send. */
class RecordingMailer implements Mailer {
	last: AgentEmail | null = null;
	async sendInviteEmail(): Promise<void> {}
	async sendVerificationCode(): Promise<void> {}
	async sendDemoLeadEmail(): Promise<void> {}
	async sendAgentEmail(email: AgentEmail): Promise<void> {
		this.last = email;
	}
}

function account(): Account {
	const timestamp = '2026-01-01T00:00:00.000Z';
	return {
		id: 'acct-1' as AccountId,
		name: 'Cascade Plumbing',
		slug: 'cascade-plumbing',
		phone: '',
		address: '',
		website: '',
		timezone: 'America/Los_Angeles',
		channels: emptyAccountChannels(),
		status: 'active',
		canceledAt: null,
		createdAt: timestamp,
		updatedAt: timestamp,
	};
}

function thread(): AgentThread {
	const timestamp = '2026-01-01T00:00:00.000Z';
	return {
		id: 'thread-1' as AgentThreadId,
		accountId: 'acct-1' as AccountId,
		channel: 'email',
		contactAddress: 'dana@example.com',
		conversationId: 'conv-1' as ConversationId,
		customerId: '',
		state: 'new',
		offeredSlots: [],
		lastExternalMessageId: '',
		subject: 'Water heater',
		bookedJobId: '',
		createdAt: timestamp,
		updatedAt: timestamp,
	};
}

function replyContext(medium: AgentReplyContext['medium']): AgentReplyContext {
	return {
		accountName: 'Cascade Plumbing',
		customerName: 'Dana Fox',
		timeZone: 'America/Los_Angeles',
		signupUrl: 'https://www.rivus.ai/customers/join/cascade-plumbing?email=d%40x.io',
		jobTitle: 'Water heater install',
		now: new Date('2026-07-03T17:00:00.000Z'),
		medium,
	};
}

interface ChannelUnderTest {
	name: string;
	adapter: ChannelAdapter;
	/** The transport's last-sent rendered body, for the non-empty assertion. */
	lastRendered(): string;
}

function emailChannel(): ChannelUnderTest {
	const mailer = new RecordingMailer();
	const { customers } = createInMemoryRepositories();
	const adapter = createEmailChannelAdapter({
		config: { AGENT_EMAIL_DOMAIN: 'riv.us' },
		customers,
		mailer,
	});
	return { name: 'email', adapter, lastRendered: () => mailer.last?.html ?? '' };
}

function whatsappChannel(): ChannelUnderTest {
	const sender = new RecordingWhatsappSender();
	const { customers } = createInMemoryRepositories();
	const adapter = createWhatsappChannelAdapter({ customers, sender });
	return { name: 'whatsapp', adapter, lastRendered: () => sender.messages.at(-1)?.text ?? '' };
}

function smsChannel(): ChannelUnderTest {
	const sender = new RecordingSmsSender();
	const { customers } = createInMemoryRepositories();
	const adapter = createSmsChannelAdapter({ customers, sender });
	return { name: 'sms', adapter, lastRendered: () => sender.messages.at(-1)?.text ?? '' };
}

function voiceChannel(): ChannelUnderTest {
	const capture = { text: '' };
	const { customers } = createInMemoryRepositories();
	const adapter = createVoiceChannelAdapter({ customers, capture });
	return { name: 'voice', adapter, lastRendered: () => capture.text };
}

// Every channel with an outbound transport. Adding one here covers it for all decisions.
const CHANNELS: Array<() => ChannelUnderTest> = [
	emailChannel,
	whatsappChannel,
	smsChannel,
	voiceChannel,
];

describe('agent response render matrix (channels × decisions)', () => {
	for (const makeChannel of CHANNELS) {
		const { name } = makeChannel();
		describe(name, () => {
			for (const decision of DECISIONS) {
				const label = decisionLabel(decision);
				it(`renders ${label} into a non-empty message and transcript line`, async () => {
					const channel = makeChannel();
					const response = composeAgentResponse(
						decision,
						replyContext(channel.adapter.capabilities.medium),
					);
					const transcriptLine = await channel.adapter.deliver(response, {
						account: account(),
						thread: thread(),
						to: { address: 'dana@example.com', name: 'Dana Fox' },
						replyToExternalId: '<m1@mail.example.com>',
						subject: 'Water heater',
					});
					expect(transcriptLine.trim().length).toBeGreaterThan(0);
					expect(channel.lastRendered().trim().length).toBeGreaterThan(0);
				});
			}
		});
	}
});

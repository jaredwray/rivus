import { faker } from '@faker-js/faker';
import type {
	Account,
	AccountId,
	AgentThread,
	AgentThreadId,
	ConversationId,
	Faq,
} from '@rivus/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { InMemoryRepositories } from '../src/repositories/memory';
import {
	defaultCapabilities,
	knowledgeCapability,
	type OrchestratorDeps,
	type TurnContext,
} from '../src/services/agent/capabilities';
import type { ChannelAdapter } from '../src/services/agent/channel';
import { handleInboundAgentMessage } from '../src/services/agent/orchestrator';
import { formatSlotLabel } from '../src/services/agent/slots';
import { createSmsChannelAdapter } from '../src/services/agent/sms/adapter';
import type { FaqAnswer, FaqAnswerService } from '../src/services/faq-answer';
import { BILLING_PAUSE_REASON, UNSURE_PAUSE_REASON } from '../src/services/inbox';
import { buildTestAppWithRepos, type RecordingSmsSender, signupOwner } from './helpers';

/**
 * The knowledge capability, driven through the real orchestrator over a real
 * channel adapter — the same path a customer's text takes. The bug this covers
 * is the agent answering "what are your hours?" with three appointment slots, so
 * the assertions are as much about what scheduling KEEPS doing (picks still book,
 * offers survive, acknowledgements still reassure) as about the new answers.
 *
 * Hermetic by construction: in-memory repositories, a scripted FAQ answerer, and
 * a fixed `now` — no model, no network, no clock.
 */

// Wednesday July 1st 2026, 10:00 UTC (a signed-up account defaults to UTC), so
// the 24-hour notice puts the first offered slot on Thursday the 2nd.
const NOW = new Date('2026-07-01T10:00:00.000Z');
const BIZ = '+15550002222';
const CONTACT = '+15559990000';
const HOURS_QUESTION = 'whats your hours of operation?';
const HOURS_ANSWER = "We're open Monday through Friday, 9:00 AM to 5:00 PM.";

/**
 * A scripted knowledge-base answerer. It records the exact candidate set it was
 * handed, which is how the published-only policy is asserted from the outside:
 * the capability must never do its own filtering, so what arrives here IS the
 * policy. An empty candidate set answers nothing, exactly like the real service.
 */
class StubFaqAnswerService implements FaqAnswerService {
	readonly grounded: Faq[][] = [];

	constructor(private readonly reply: string) {}

	async answer(_input: { question: string }, candidates: Faq[]): Promise<FaqAnswer> {
		this.grounded.push(candidates);
		const [first] = candidates;
		if (!first) {
			return { answered: false, answer: '', sources: [] };
		}
		return { answered: true, answer: this.reply, sources: [first.id] };
	}
}

interface Harness {
	app: FastifyInstance;
	repos: InMemoryRepositories;
	accountId: AccountId;
	account: Account;
	adapter: ChannelAdapter;
	deps: OrchestratorDeps;
	faqAnswer: StubFaqAnswerService;
	sent: RecordingSmsSender;
	/** Run one inbound text through the whole pipeline. */
	inbound(text: string, externalMessageId?: string): Promise<{ handled: boolean; outcome: string }>;
	/** The last reply the customer would have received. */
	lastReply(): string;
	thread(): Promise<AgentThread>;
}

async function setup(options: { withCustomer?: boolean } = {}): Promise<Harness> {
	const faqAnswer = new StubFaqAnswerService(HOURS_ANSWER);
	const { app, repos } = await buildTestAppWithRepos({ faqAnswer });
	const owner = await signupOwner(app);
	const accountId = owner.account.id as AccountId;
	await repos.accounts.setChannelConfig(accountId, 'sms', {
		enabled: true,
		address: BIZ,
		providerRef: BIZ,
	});
	const account = await repos.accounts.findById(accountId);
	if (!account) {
		throw new Error('expected the signed-up account to exist');
	}
	if (options.withCustomer !== false) {
		await repos.customers.create(accountId, {
			name: 'Dana Fox',
			email: '',
			phone: CONTACT,
			address: faker.location.streetAddress(),
			lifetimeValue: 0,
			balance: 0,
			notes: '',
		});
	}
	const sent = app.deps.smsSender as RecordingSmsSender;
	const adapter = createSmsChannelAdapter({ customers: repos.customers, sender: sent });
	const deps: OrchestratorDeps = {
		config: app.deps.config,
		jobs: repos.jobs,
		conversations: repos.conversations,
		agentThreads: repos.agentThreads,
		faqs: repos.faqs,
		faqAnswer,
		memberships: repos.memberships,
		notifier: app.deps.notifier,
	};
	const capabilities = defaultCapabilities();
	return {
		app,
		repos,
		accountId,
		account,
		adapter,
		deps,
		faqAnswer,
		sent,
		inbound: (text, externalMessageId) =>
			handleInboundAgentMessage({
				deps,
				adapter,
				capabilities,
				account,
				message: {
					sender: { address: CONTACT, name: 'Dana' },
					text,
					subject: '',
					externalMessageId: externalMessageId ?? faker.string.uuid(),
				},
				logger: app.log,
				now: NOW,
			}),
		lastReply: () => sent.messages.at(-1)?.text ?? '',
		thread: async () => {
			const thread = await repos.agentThreads.findByContact(accountId, 'sms', CONTACT);
			if (!thread) {
				throw new Error('expected the contact to have an agent thread');
			}
			return thread;
		},
	};
}

async function publishHoursFaq(harness: Harness): Promise<Faq> {
	return harness.repos.faqs.create(harness.accountId, {
		question: 'What are your business hours?',
		answer: HOURS_ANSWER,
		category: 'General',
		status: 'published',
	});
}

/** The owner's notifications — the team alert a held turn is supposed to raise. */
async function reviewAlerts(harness: Harness): Promise<number> {
	const userId = (await harness.repos.memberships.listByAccount(harness.accountId))[0]?.userId;
	if (!userId) {
		throw new Error('expected the owner to have a membership');
	}
	const { notifications } = await harness.repos.notifications.list({
		accountId: harness.accountId,
		userId,
		page: 1,
		pageSize: 50,
		unreadOnly: false,
	});
	return notifications.filter((entry) => entry.title === 'A conversation needs you').length;
}

describe('knowledge capability — answering instead of offering slots', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('answers a question asked mid-offer and keeps the standing offer intact', async () => {
		const harness = await setup();
		app = harness.app;
		await publishHoursFaq(harness);

		const offered = await harness.inbound('Can I get someone out to look at my water heater?');
		expect(offered.outcome).toBe('offer_slots');
		const slots = (await harness.thread()).offeredSlots;
		expect(slots.length).toBeGreaterThan(1);

		// The bug: this used to come back as three appointment slots and no answer.
		const answered = await harness.inbound(HOURS_QUESTION);
		expect(answered.outcome).toBe('answer_question');
		const reply = harness.lastReply();
		expect(reply).toContain(HOURS_ANSWER);

		// The offer is restated with the SAME slots in the SAME order, so the numbers
		// the customer was already given still mean the same windows.
		slots.forEach((slot, index) => {
			expect(reply).toContain(`${index + 1}. ${formatSlotLabel(slot.startAt, 'UTC', 2026)}`);
		});
		const after = await harness.thread();
		expect(after.state).toBe('slots_offered');
		expect(after.offeredSlots).toEqual(slots);
		expect(
			(await harness.repos.jobs.list({ accountId: harness.accountId, page: 1, pageSize: 10 }))
				.total,
		).toBe(0);

		// …and the pick that follows the answer books exactly what it says it does.
		const booked = await harness.inbound('2');
		expect(booked.outcome).toBe('book');
		const { jobs } = await harness.repos.jobs.list({
			accountId: harness.accountId,
			page: 1,
			pageSize: 10,
		});
		expect(jobs).toHaveLength(1);
		expect(jobs[0]?.startAt).toBe(slots[1]?.startAt);
	});

	it('answers on a fresh thread and invites the customer to book', async () => {
		const harness = await setup();
		app = harness.app;
		await publishHoursFaq(harness);

		const answered = await harness.inbound(HOURS_QUESTION);
		expect(answered.outcome).toBe('answer_question');
		expect(harness.lastReply()).toContain(HOURS_ANSWER);
		// No slots were invented to fill the reply.
		expect(harness.lastReply()).not.toContain('1. ');
		expect(harness.lastReply()).toContain('Want to book a time?');
		const thread = await harness.thread();
		expect(thread.state).toBe('new');
		expect(thread.offeredSlots).toEqual([]);
	});

	it('never grounds an answer in a draft FAQ', async () => {
		const harness = await setup();
		app = harness.app;
		await harness.repos.faqs.create(harness.accountId, {
			question: 'What are your business hours?',
			answer: 'Draft answer nobody approved yet.',
			category: 'General',
			status: 'draft',
		});

		const result = await harness.inbound(HOURS_QUESTION);
		// The staged draft never reaches the answering service, so there is nothing
		// to answer from and the turn goes to a human instead.
		expect(harness.faqAnswer.grounded.at(-1)).toEqual([]);
		expect(result.outcome).toBe('hold_for_team');
		expect(harness.lastReply()).not.toContain('Draft answer');
	});

	it('answers a booked contact without touching the booking or re-offering', async () => {
		const harness = await setup();
		app = harness.app;
		await publishHoursFaq(harness);
		await harness.inbound('Can I get someone out to look at my water heater?');
		const booked = await harness.inbound('1');
		expect(booked.outcome).toBe('book');
		const bookedThread = await harness.thread();

		const answered = await harness.inbound(HOURS_QUESTION);
		expect(answered.outcome).toBe('answer_question');
		expect(harness.lastReply()).toContain(HOURS_ANSWER);
		expect(harness.lastReply()).not.toContain('1. ');
		const after = await harness.thread();
		expect(after.state).toBe('booked');
		expect(after.bookedJobId).toBe(bookedThread.bookedJobId);
		expect(
			(await harness.repos.jobs.list({ accountId: harness.accountId, page: 1, pageSize: 10 }))
				.total,
		).toBe(1);
	});
});

describe('greeting a known customer', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('greets back instead of opening with appointment slots', async () => {
		const harness = await setup();
		app = harness.app;

		// The reported bug: a known customer's first "Hello" came back as a slot menu.
		const result = await harness.inbound('Hello');
		expect(result.outcome).toBe('greet');
		expect(harness.lastReply()).not.toContain('1. ');
		expect(harness.lastReply()).toContain('book you an appointment or answer questions');
		// Saying hello moves nothing, so the next message starts where the thread was.
		expect((await harness.thread()).state).toBe('new');
		// …and the conversation is still Rivus's to handle — nobody was paged.
		expect(await reviewAlerts(harness)).toBe(0);
	});

	it('still offers times once the greeting carries a request', async () => {
		const harness = await setup();
		app = harness.app;

		expect((await harness.inbound('Hello')).outcome).toBe('greet');
		expect((await harness.inbound('hi, my water heater is leaking')).outcome).toBe('offer_slots');
	});
});

describe('knowledge capability — handing a turn to the team', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('holds an unanswerable question for a human, flags the thread, and alerts the team', async () => {
		const harness = await setup();
		app = harness.app;

		const result = await harness.inbound('do you do tile work?');
		expect(result.outcome).toBe('hold_for_team');
		// Crucially: no appointment times in a reply to a question.
		expect(harness.lastReply()).not.toContain('1. ');
		expect(harness.lastReply()).toContain('passed it to');

		const thread = await harness.thread();
		const conversation = await harness.repos.conversations.findById(
			harness.accountId,
			thread.conversationId,
		);
		expect(conversation?.status).toBe('needs_attention');
		expect(conversation?.flagReason).toBe(UNSURE_PAUSE_REASON);
		expect(conversation?.pendingReply).toBe('');
		expect(await reviewAlerts(harness)).toBe(1);
	});

	it('does not flag or notify twice when the same turn is reprocessed', async () => {
		const harness = await setup();
		app = harness.app;

		// A channel that sends no message id (voice) has the orchestrator's dedup
		// switched off, so the flag's own guard is the only thing standing between a
		// reprocessed turn and a second alert for every member.
		const first = await harness.inbound('do you do tile work?', '');
		const second = await harness.inbound('do you do tile work?', '');
		expect(first.outcome).toBe('hold_for_team');
		expect(second.outcome).toBe('hold_for_team');
		expect(await reviewAlerts(harness)).toBe(1);
	});

	it('pauses a money question even when the knowledge base answered it', async () => {
		const harness = await setup();
		app = harness.app;
		await publishHoursFaq(harness);

		const result = await harness.inbound('how much do I owe on my invoice?');
		expect(result.outcome).toBe('hold_for_team');
		// The draft is kept for the human to approve — it is never sent by the agent.
		const thread = await harness.thread();
		const conversation = await harness.repos.conversations.findById(
			harness.accountId,
			thread.conversationId,
		);
		expect(conversation?.status).toBe('needs_attention');
		expect(conversation?.flagReason).toBe(BILLING_PAUSE_REASON);
		expect(conversation?.pendingReply).toBe(HOURS_ANSWER);
		expect(harness.lastReply()).not.toContain(HOURS_ANSWER);
	});
});

describe('knowledge capability — contacts the CRM does not know', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('answers a stranger and points them at self-signup', async () => {
		const harness = await setup({ withCustomer: false });
		app = harness.app;
		await publishHoursFaq(harness);

		const result = await harness.inbound(HOURS_QUESTION);
		expect(result.outcome).toBe('answer_question');
		expect(harness.lastReply()).toContain(HOURS_ANSWER);
		expect(harness.lastReply()).toContain(`phone=${encodeURIComponent(CONTACT)}`);
		const thread = await harness.thread();
		expect(thread.state).toBe('awaiting_signup');
		expect(thread.offeredSlots).toEqual([]);
	});

	it('keeps the plain signup reply when a stranger asks something unanswerable', async () => {
		const harness = await setup({ withCustomer: false });
		app = harness.app;

		// Nobody is paged about a number with no customer record behind it.
		const result = await harness.inbound('do you do tile work?');
		expect(result.outcome).toBe('send_signup_link');
		expect(await reviewAlerts(harness)).toBe(0);
		expect((await harness.thread()).state).toBe('awaiting_signup');
	});
});

describe('knowledge capability — turns it must never claim', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	/** A turn context shaped exactly as the orchestrator builds one. */
	function contextFor(
		harness: Harness,
		text: string,
		thread: Partial<AgentThread> = {},
	): TurnContext {
		const timestamp = '2026-06-01T00:00:00.000Z';
		return {
			account: harness.account,
			customer: null,
			thread: {
				id: 'thread-1' as AgentThreadId,
				accountId: harness.accountId,
				channel: 'sms',
				contactAddress: CONTACT,
				conversationId: 'conv-1' as ConversationId,
				customerId: '',
				state: 'new',
				offeredSlots: [],
				lastExternalMessageId: '',
				subject: '',
				bookedJobId: '',
				createdAt: timestamp,
				updatedAt: timestamp,
				...thread,
			},
			message: {
				sender: { address: CONTACT, name: 'Dana' },
				text,
				subject: '',
				externalMessageId: '',
			},
			caps: harness.adapter.capabilities,
			timeZone: 'UTC',
			now: NOW,
			signupUrl: 'https://www.rivus.ai/customers/join/acme?phone=%2B15559990000',
			jobTitle: 'Appointment',
			deps: harness.deps,
		};
	}

	const OFFERED = [
		{ startAt: '2026-07-02T09:00:00.000Z', durationMinutes: 60 },
		{ startAt: '2026-07-03T09:00:00.000Z', durationMinutes: 60 },
	];
	const BOOKED_THREAD: Partial<AgentThread> = { state: 'booked', bookedJobId: 'job-1' };
	const OFFERED_THREAD: Partial<AgentThread> = { state: 'slots_offered', offeredSlots: OFFERED };

	it.each([
		['a bare slot pick', '2', OFFERED_THREAD],
		['a keyworded slot pick', 'option 2', OFFERED_THREAD],
		['a slot named by its day', 'thursday works', OFFERED_THREAD],
		['a proposed time', 'tuesday at 2pm', {}],
		['a proposed time in a question', 'can you do tomorrow at 9?', {}],
		['a day named with no time on it', 'do you have anything thursday?', {}],
		['a day-only availability question', 'what availability do you have next thursday?', {}],
		['an availability question', 'when can you come out?', {}],
		['an availability question with a question mark', 'what times do you have available?', {}],
		['an acknowledgement on a booked thread', 'thanks, see you then!', BOOKED_THREAD],
		['a bare confirmation on a booked thread', 'Confirmed!', BOOKED_THREAD],
	])('yields %s to the scheduling engine', async (_label, text, thread) => {
		const harness = await setup();
		app = harness.app;
		expect(knowledgeCapability.matches(contextFor(harness, text, thread))).toBe(false);
	});

	it('claims a question whether or not an offer is standing', async () => {
		const harness = await setup();
		app = harness.app;
		expect(knowledgeCapability.matches(contextFor(harness, HOURS_QUESTION))).toBe(true);
		expect(knowledgeCapability.matches(contextFor(harness, HOURS_QUESTION, OFFERED_THREAD))).toBe(
			true,
		);
	});

	it('leaves the scheduling outcomes for those turns exactly as they were', async () => {
		const harness = await setup();
		app = harness.app;
		await publishHoursFaq(harness);

		expect((await harness.inbound('when can you come out?')).outcome).toBe('offer_slots');
		expect((await harness.inbound('what times do you have available?')).outcome).toBe(
			'offer_slots',
		);
		expect((await harness.inbound('1')).outcome).toBe('book');
		expect((await harness.inbound('thanks, see you then!')).outcome).toBe('confirm_existing');
	});

	it('answers a day-only question about the day it names, over the same channel', async () => {
		const harness = await setup();
		app = harness.app;
		await publishHoursFaq(harness);

		// NOW is Wednesday July 1st (UTC account), so "thursday" is the 2nd.
		const result = await harness.inbound('do you have anything thursday?');
		expect(result.outcome).toBe('offer_slots');
		const reply = harness.lastReply();
		expect(reply).toContain('has open on Thursday, July 2:');
		const offered = (await harness.thread()).offeredSlots;
		expect(offered.length).toBeGreaterThan(0);
		for (const slot of offered) {
			expect(slot.startAt.slice(0, 10)).toBe('2026-07-02');
		}
	});
});

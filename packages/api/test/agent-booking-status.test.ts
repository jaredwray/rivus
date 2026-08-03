import { faker } from '@faker-js/faker';
import type {
	Account,
	AccountId,
	AgentThread,
	CreateJobInput,
	CustomerId,
	Faq,
	JobId,
} from '@rivus/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { InMemoryRepositories } from '../src/repositories/memory';
import {
	defaultCapabilities,
	loadUpcomingBookings,
	type OrchestratorDeps,
	RetryDeliveryError,
} from '../src/services/agent/capabilities';
import type { ChannelAdapter } from '../src/services/agent/channel';
import { handleInboundAgentMessage } from '../src/services/agent/orchestrator';
import { createSmsChannelAdapter } from '../src/services/agent/sms/adapter';
import type { FaqAnswer, FaqAnswerService } from '../src/services/faq-answer';
import { buildTestAppWithRepos, type RecordingSmsSender, signupOwner } from './helpers';

/**
 * The booking-status capability, driven through the real orchestrator over a
 * real channel adapter — the same path a customer's text takes. The bug it
 * covers is the reported transcript: "What appointment do I have coming up?"
 * answered with three fresh openings, which both ignores the question and
 * invites a customer who is already on the calendar to book a second visit.
 *
 * So the assertions are as much about what the other capabilities KEEP doing
 * (booking requests still offer, picks still book, FAQs are still answered) as
 * about the new answer. Hermetic by construction: in-memory repositories, a
 * scripted FAQ answerer, and a fixed `now` — no model, no network, no clock.
 */

// Wednesday July 1st 2026, 10:00 UTC (a signed-up account defaults to UTC), so
// the 24-hour notice puts the first offered slot on Thursday the 2nd.
const NOW = new Date('2026-07-01T10:00:00.000Z');
const BIZ = '+15550002222';
const CONTACT = '+15559990000';
const OTHER_CONTACT = '+15551110000';
const QUESTION = 'What appointment do I have coming up?';
const HOURS_QUESTION = 'whats your hours of operation?';
const HOURS_ANSWER = "We're open Monday through Friday, 9:00 AM to 5:00 PM.";
/** Friday July 3rd at 3:00 PM UTC — two days out, inside business hours. */
const BOOKED_AT = '2026-07-03T15:00:00.000Z';
const BOOKED_LABEL = 'Friday, July 3 at 3:00 PM';

/** A knowledge-base answerer that answers from whatever published FAQ it is handed. */
class StubFaqAnswerService implements FaqAnswerService {
	async answer(_input: { question: string }, candidates: Faq[]): Promise<FaqAnswer> {
		const [first] = candidates;
		return first
			? { answered: true, answer: HOURS_ANSWER, sources: [first.id] }
			: { answered: false, answer: '', sources: [] };
	}
}

interface Harness {
	app: FastifyInstance;
	repos: InMemoryRepositories;
	accountId: AccountId;
	account: Account;
	adapter: ChannelAdapter;
	deps: OrchestratorDeps;
	customerId: CustomerId;
	sent: RecordingSmsSender;
	/** Run one inbound text through the whole pipeline. */
	inbound(text: string, externalMessageId?: string): Promise<{ handled: boolean; outcome: string }>;
	/** The last reply the customer would have received. */
	lastReply(): string;
	thread(): Promise<AgentThread>;
	/** Put a job on the account's calendar the way the team's app would. */
	book(input: Partial<CreateJobInput> & { startAt: string }): Promise<JobId>;
}

async function setup(options: { withCustomer?: boolean } = {}): Promise<Harness> {
	const { app, repos } = await buildTestAppWithRepos({ faqAnswer: new StubFaqAnswerService() });
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
	const customer =
		options.withCustomer === false
			? null
			: await repos.customers.create(accountId, {
					name: 'Dana Fox',
					email: '',
					phone: CONTACT,
					address: faker.location.streetAddress(),
					lifetimeValue: 0,
					balance: 0,
					notes: '',
				});
	const sent = app.deps.smsSender as RecordingSmsSender;
	const adapter = createSmsChannelAdapter({ customers: repos.customers, sender: sent });
	const deps: OrchestratorDeps = {
		config: app.deps.config,
		jobs: repos.jobs,
		conversations: repos.conversations,
		agentThreads: repos.agentThreads,
		faqs: repos.faqs,
		faqAnswer: app.deps.faqAnswer,
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
		customerId: (customer?.id ?? '') as CustomerId,
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
		book: async (input) => {
			const job = await repos.jobs.create(accountId, {
				title: 'Water heater install',
				customerId: customer?.id ?? '',
				assignedUserId: '',
				durationMinutes: 60,
				status: 'confirmed',
				address: '',
				notes: '',
				estimatedValue: 0,
				...input,
			});
			return job.id;
		},
	};
}

describe('booking status — answering what the customer already has', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('answers the reported question with the appointment, not with three fresh openings', async () => {
		const harness = await setup();
		app = harness.app;
		// Booked over the phone and entered by the team: this thread has never seen it.
		await harness.book({ startAt: BOOKED_AT });

		const result = await harness.inbound(QUESTION);

		expect(result.outcome).toBe('booking_status');
		const reply = harness.lastReply();
		expect(reply).toContain("Here's what you have coming up with");
		expect(reply).toContain(`Water heater install — ${BOOKED_LABEL} (60 minutes).`);
		// The bug, verbatim: this used to come back as a numbered list of openings.
		expect(reply).not.toContain('next openings');
		expect(reply).not.toContain('1.');
		// Reporting a booking moves nothing on the thread.
		const thread = await harness.thread();
		expect(thread.state).toBe('new');
		expect(thread.offeredSlots).toEqual([]);
		expect(thread.bookedJobId).toBe('');
	});

	it('reports the visit already under way when asked when someone is coming', async () => {
		const harness = await setup();
		app = harness.app;
		// Started half an hour ago and still running: `startAt` is past, the visit isn't.
		await harness.book({
			startAt: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
			status: 'in_progress',
		});

		const result = await harness.inbound('when are you coming?');

		expect(result.outcome).toBe('booking_status');
		expect(harness.lastReply()).toContain('Water heater install —');
	});

	it('lists several appointments soonest-first and says when there are more', async () => {
		const harness = await setup();
		app = harness.app;
		await harness.book({ startAt: '2026-07-09T15:00:00.000Z', title: 'Fourth visit' });
		await harness.book({ startAt: BOOKED_AT, title: 'First visit' });
		await harness.book({ startAt: '2026-07-07T15:00:00.000Z', title: 'Third visit' });
		await harness.book({ startAt: '2026-07-06T15:00:00.000Z', title: 'Second visit' });

		const result = await harness.inbound('what do I have coming up?');

		expect(result.outcome).toBe('booking_status');
		const reply = harness.lastReply();
		expect(reply.indexOf('First visit')).toBeLessThan(reply.indexOf('Second visit'));
		expect(reply.indexOf('Second visit')).toBeLessThan(reply.indexOf('Third visit'));
		// Capped at three — and the reply says so rather than implying that is everything.
		expect(reply).not.toContain('Fourth visit');
		expect(reply).toContain('Those are the next 3');
	});

	it('reads past a page of canceled jobs to find the appointment that stands', async () => {
		const harness = await setup();
		app = harness.app;
		// A serially-rescheduled customer: more canceled rows than fit on one page,
		// all sorting ahead of the live one.
		for (let index = 0; index < 30; index += 1) {
			await harness.book({
				startAt: new Date(NOW.getTime() + (index + 1) * 60 * 60_000).toISOString(),
				status: 'canceled',
				title: 'Called off',
			});
		}
		await harness.book({ startAt: BOOKED_AT });

		const result = await harness.inbound(QUESTION);

		expect(result.outcome).toBe('booking_status');
		expect(harness.lastReply()).toContain(`Water heater install — ${BOOKED_LABEL}`);
		expect(harness.lastReply()).not.toContain('Called off');
	});

	it('reports an appointment further out than the agent would book one itself', async () => {
		const harness = await setup();
		app = harness.app;
		// 90 days out — past the 60-day booking horizon, but the team can book it.
		await harness.book({ startAt: '2026-09-29T15:00:00.000Z' });

		const result = await harness.inbound(QUESTION);

		expect(result.outcome).toBe('booking_status');
		expect(harness.lastReply()).toContain('Tuesday, September 29 at 3:00 PM');
	});

	it('keeps a standing offer alive when the question interrupts one', async () => {
		const harness = await setup();
		app = harness.app;
		await harness.book({ startAt: BOOKED_AT });
		const offered = await harness.inbound('I need to reschedule my appointment');
		expect(offered.outcome).toBe('offer_slots');
		const slots = (await harness.thread()).offeredSlots;
		expect(slots.length).toBeGreaterThan(1);

		const result = await harness.inbound(QUESTION);

		expect(result.outcome).toBe('booking_status');
		expect(harness.lastReply()).toContain('The times I offered are still open:');
		// Same slots, same order — the numbers the contact was given still mean the
		// same windows, and a "2" back still resolves to the second one. With an
		// appointment already on the calendar that pick MOVES it (the full flow is
		// pinned in agent-reschedule.test.ts) — it must never book a second visit.
		expect((await harness.thread()).offeredSlots).toEqual(slots);
		const moved = await harness.inbound('2');
		expect(moved.outcome).toBe('reschedule');
		const { jobs, total } = await harness.repos.jobs.list({
			accountId: harness.accountId,
			page: 1,
			pageSize: 50,
		});
		expect(total).toBe(1);
		expect(jobs[0]?.startAt).toBe(slots[1]?.startAt);
	});

	it('leaves a thread that booked through the agent exactly as it was', async () => {
		const harness = await setup();
		app = harness.app;
		await harness.inbound('Can I get someone out to look at my water heater?');
		const booked = await harness.inbound('1');
		expect(booked.outcome).toBe('book');
		const before = await harness.thread();

		const result = await harness.inbound('is my appointment still on?');

		expect(result.outcome).toBe('booking_status');
		const after = await harness.thread();
		expect(after.state).toBe('booked');
		expect(after.bookedJobId).toBe(before.bookedJobId);
	});
});

describe('booking status — when nothing is on the calendar', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('says so plainly, then offers what is open', async () => {
		const harness = await setup();
		app = harness.app;

		const result = await harness.inbound(QUESTION);

		expect(result.outcome).toBe('no_booking');
		const reply = harness.lastReply();
		expect(reply).toContain("I don't see anything booked for you with");
		expect(reply).toContain('Here is what we do have open:');
		expect(reply).toContain('1.');
		// The openings were numbered in the reply, so they become the standing offer.
		const thread = await harness.thread();
		expect(thread.state).toBe('slots_offered');
		expect(thread.offeredSlots.length).toBeGreaterThan(1);

		const booked = await harness.inbound('2');
		expect(booked.outcome).toBe('book');
	});

	it.each([
		['a canceled appointment', 'canceled' as const],
		['a completed one', 'completed' as const],
	])('never reports %s as coming up', async (_label, status) => {
		const harness = await setup();
		app = harness.app;
		await harness.book({ startAt: BOOKED_AT, status });

		const result = await harness.inbound(QUESTION);

		expect(result.outcome).toBe('no_booking');
		expect(harness.lastReply()).not.toContain(BOOKED_LABEL);
	});

	it('never reports an appointment that has already finished', async () => {
		const harness = await setup();
		app = harness.app;
		// Started three hours ago and ran an hour: inside the query's lookback, over.
		await harness.book({ startAt: new Date(NOW.getTime() - 3 * 60 * 60_000).toISOString() });

		const result = await harness.inbound(QUESTION);

		expect(result.outcome).toBe('no_booking');
	});

	it("never reports another customer's appointment", async () => {
		const harness = await setup();
		app = harness.app;
		const other = await harness.repos.customers.create(harness.accountId, {
			name: 'Sam Reed',
			email: '',
			phone: OTHER_CONTACT,
			address: '',
			lifetimeValue: 0,
			balance: 0,
			notes: '',
		});
		await harness.repos.jobs.create(harness.accountId, {
			title: 'Someone elses install',
			customerId: other.id,
			assignedUserId: '',
			startAt: BOOKED_AT,
			durationMinutes: 60,
			status: 'confirmed',
			address: '',
			notes: '',
			estimatedValue: 0,
		});

		const result = await harness.inbound(QUESTION);

		expect(result.outcome).toBe('no_booking');
		expect(harness.lastReply()).not.toContain('Someone elses install');
	});

	it('sends a stranger the signup link rather than a calendar it cannot read', async () => {
		const harness = await setup({ withCustomer: false });
		app = harness.app;

		const result = await harness.inbound(QUESTION);

		expect(result.outcome).toBe('send_signup_link');
		expect(harness.lastReply()).toContain('customer list');
	});

	it('fails the delivery rather than answering from a partly-read calendar', async () => {
		// A repository that never runs out of pages of dead rows: the backstop must
		// give up and let the provider redeliver instead of reporting "nothing booked".
		const canceled = {
			startAt: BOOKED_AT,
			durationMinutes: 60,
			status: 'canceled',
			title: 'Called off',
		};
		const jobs = {
			list: async () => ({ jobs: [canceled], total: Number.MAX_SAFE_INTEGER }),
		} as unknown as OrchestratorDeps['jobs'];

		await expect(
			loadUpcomingBookings(jobs, 'acct-1' as AccountId, 'cust-1' as CustomerId, NOW),
		).rejects.toBeInstanceOf(RetryDeliveryError);
	});
});

describe('booking status — turns it must never claim', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('leaves an explicit request for a second visit to scheduling', async () => {
		const harness = await setup();
		app = harness.app;
		await harness.book({ startAt: BOOKED_AT });

		const result = await harness.inbound('can I book another appointment for the upstairs bath?');

		expect(result.outcome).toBe('offer_slots');
		expect(harness.lastReply()).not.toContain("Here's what you have coming up");
		expect(harness.lastReply()).toContain('next openings');
	});

	it.each([
		['a plain booking request', 'Can I get someone out to look at my water heater?'],
		['an availability ask', 'what times do you have this week?'],
	])('asks for intent before %s can change an existing appointment', async (_label, text) => {
		const harness = await setup();
		app = harness.app;
		await harness.book({ startAt: BOOKED_AT });

		const result = await harness.inbound(text);

		expect(result.outcome).toBe('booking_choice');
		expect(harness.lastReply()).toContain('reschedule that appointment');
		expect(harness.lastReply()).toContain('keep it as-is');
		expect(harness.lastReply()).toContain('add another appointment');
	});

	it('still answers a question about the business from the knowledge base', async () => {
		const harness = await setup();
		app = harness.app;
		await harness.book({ startAt: BOOKED_AT });
		await harness.repos.faqs.create(harness.accountId, {
			question: 'What are your business hours?',
			answer: HOURS_ANSWER,
			category: 'General',
			status: 'published',
		});

		const result = await harness.inbound(HOURS_QUESTION);

		expect(result.outcome).toBe('answer_question');
		expect(harness.lastReply()).toContain(HOURS_ANSWER);
	});

	it('still reassures an acknowledgement on a booked thread', async () => {
		const harness = await setup();
		app = harness.app;
		await harness.inbound('Can I get someone out to look at my water heater?');
		await harness.inbound('1');

		const result = await harness.inbound('thanks, see you then!');

		expect(result.outcome).toBe('confirm_existing');
	});

	it('asks for intent before acting on a proposal when an appointment already exists', async () => {
		const harness = await setup();
		app = harness.app;
		await harness.book({ startAt: BOOKED_AT });

		// A complete day + time is a booking request however the rest of it reads.
		const result = await harness.inbound('when is my appointment — can you do Monday at 10am?');

		expect(result.outcome).toBe('booking_choice');
	});
});

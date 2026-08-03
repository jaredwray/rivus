import { faker } from '@faker-js/faker';
import type {
	Account,
	AccountId,
	AgentThread,
	CreateJobInput,
	CustomerId,
	JobId,
	UserId,
} from '@rivus/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { InMemoryRepositories } from '../src/repositories/memory';
import { VOICE_TERMINAL_OUTCOMES } from '../src/routes/agent-voice-shared';
import { defaultCapabilities, type OrchestratorDeps } from '../src/services/agent/capabilities';
import type { ChannelAdapter } from '../src/services/agent/channel';
import { handleInboundAgentMessage } from '../src/services/agent/orchestrator';
import { createSmsChannelAdapter } from '../src/services/agent/sms/adapter';
import { buildTestAppWithRepos, type RecordingSmsSender, signupOwner } from './helpers';

/**
 * The reschedule guard, driven through the real orchestrator over a real
 * channel adapter — the reported transcript's exact path. A booked customer
 * asked to change their time, the agent answered with a numbered offer, they
 * picked "2" — and the agent booked a SECOND appointment while the first stood,
 * behind a confident "You're booked!". These tests pin the fix: that pick (or a
 * suggested time while the offer stands) MOVES the appointment they already
 * have — same job row, calendar total unchanged, both windows named in the
 * reply — and pin every deliberate boundary of the guard: an explicit
 * additional-visit ask still books a second job, more than one upcoming job
 * hands the move to a human, the move re-validates the window at the job's own
 * duration, and a failed send restores the original time exactly.
 */

// Wednesday July 1st 2026, 10:00 UTC (a signed-up account defaults to UTC), so
// the 24-hour notice puts the first offered slot at Thursday the 2nd, 10:00.
const NOW = new Date('2026-07-01T10:00:00.000Z');
const BIZ = '+15550002222';
const CONTACT = '+15559990000';
const OTHER_CONTACT = '+15551110000';
/** Friday July 3rd at 3:00 PM UTC — the appointment the customer already has. */
const BOOKED_AT = '2026-07-03T15:00:00.000Z';
const BOOKED_LABEL = 'Friday, July 3 at 3:00 PM';
/** What `computeOpenSlots` offers against an otherwise-empty week (see NOW). */
const OFFERED = [
	'2026-07-02T10:00:00.000Z',
	'2026-07-03T09:00:00.000Z',
	'2026-07-06T09:00:00.000Z',
];

interface Harness {
	app: FastifyInstance;
	repos: InMemoryRepositories;
	accountId: AccountId;
	account: Account;
	adapter: ChannelAdapter;
	deps: OrchestratorDeps;
	customerId: CustomerId;
	ownerId: UserId;
	sent: RecordingSmsSender;
	/** Run one inbound text through the whole pipeline. */
	inbound(text: string, externalMessageId?: string): Promise<{ handled: boolean; outcome: string }>;
	/** The last reply the customer would have received. */
	lastReply(): string;
	thread(): Promise<AgentThread>;
	/** Put a job on the account's calendar the way the team's app would. */
	book(input: Partial<CreateJobInput> & { startAt: string }): Promise<JobId>;
	/** Every non-canceled job of the harness customer, soonest first. */
	customerJobs(): Promise<Array<{ id: JobId; startAt: string; durationMinutes: number }>>;
	/** The transcript of the contact's conversation, as plain bodies. */
	transcript(): Promise<string[]>;
}

async function setup(): Promise<Harness> {
	const { app, repos } = await buildTestAppWithRepos();
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
	const customer = await repos.customers.create(accountId, {
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
	const thread = async () => {
		const found = await repos.agentThreads.findByContact(accountId, 'sms', CONTACT);
		if (!found) {
			throw new Error('expected the contact to have an agent thread');
		}
		return found;
	};
	return {
		app,
		repos,
		accountId,
		account,
		adapter,
		deps,
		customerId: customer.id,
		ownerId: owner.user.id as UserId,
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
		thread,
		book: async (input) => {
			const job = await repos.jobs.create(accountId, {
				title: 'Water heater install',
				customerId: customer.id,
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
		customerJobs: async () => {
			const { jobs } = await repos.jobs.list({
				accountId,
				customerId: customer.id,
				page: 1,
				pageSize: 50,
			});
			return jobs
				.filter((job) => job.status !== 'canceled')
				.map((job) => ({ id: job.id, startAt: job.startAt, durationMinutes: job.durationMinutes }));
		},
		transcript: async () => {
			const messages = await repos.conversations.listMessages(
				accountId,
				(await thread()).conversationId,
			);
			return (messages ?? []).map((message) => message.body);
		},
	};
}

describe('reschedule — a pick while booked moves the appointment, never doubles it', () => {
	let app: FastifyInstance | undefined;
	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it('asks what to do with an upcoming appointment before offering or moving anything', async () => {
		const harness = await setup();
		app = harness.app;
		const jobId = await harness.book({ startAt: BOOKED_AT });

		const asked = await harness.inbound('What openings do you have next week?');

		expect(asked.outcome).toBe('booking_choice');
		expect(harness.lastReply()).toContain(
			`You already have Water heater install coming up on ${BOOKED_LABEL} (60 minutes).`,
		);
		expect(harness.lastReply()).toContain(
			'Do you want to reschedule that appointment, keep it as-is, or add another appointment?',
		);
		expect((await harness.thread()).state).toBe('booking_choice');
		expect((await harness.thread()).offeredSlots).toEqual([]);

		// A day is not consent to move the existing booking. Repeat the choice and
		// leave the calendar alone until the customer says what they mean.
		const ambiguous = await harness.inbound("Let's do Thursday");
		expect(ambiguous.outcome).toBe('booking_choice');
		expect((await harness.customerJobs())[0]?.startAt).toBe(BOOKED_AT);

		const reschedule = await harness.inbound('reschedule it');
		expect(reschedule.outcome).toBe('offer_slots');
		expect((await harness.thread()).state).toBe('slots_offered');

		const picked = await harness.inbound('1');
		expect(picked.outcome).toBe('reschedule');
		const jobs = await harness.customerJobs();
		expect(jobs).toHaveLength(1);
		expect(jobs[0]?.id).toBe(jobId);
		expect(jobs[0]?.startAt).toBe(OFFERED[0]);
	});

	it('keeps the current appointment when that is the customer choice', async () => {
		const harness = await setup();
		app = harness.app;
		const jobId = await harness.book({ startAt: BOOKED_AT });
		await harness.inbound('Can I schedule an appointment?');

		const result = await harness.inbound('keep the current one');

		expect(result.outcome).toBe('confirm_existing');
		expect(await harness.customerJobs()).toHaveLength(1);
		expect((await harness.thread()).bookedJobId).toBe(jobId);
	});

	it('books a second visit only after the customer chooses to add another', async () => {
		const harness = await setup();
		app = harness.app;
		await harness.book({ startAt: BOOKED_AT });
		await harness.inbound('Can I schedule an appointment?');

		const add = await harness.inbound('add another appointment');
		expect(add.outcome).toBe('offer_slots');
		expect((await harness.thread()).state).toBe('additional_slots_offered');

		const picked = await harness.inbound('1');
		expect(picked.outcome).toBe('book');
		expect(await harness.customerJobs()).toHaveLength(2);
	});

	it('moves the existing appointment when the customer picks an offered time (the reported transcript)', async () => {
		const harness = await setup();
		app = harness.app;
		// Booked over the phone and entered by the team: this thread has never seen it.
		const jobId = await harness.book({ startAt: BOOKED_AT });

		// "I need to reschedule" has no reschedule capability yet, so it falls
		// through to a generic numbered offer — exactly the reported conversation.
		const offered = await harness.inbound('I need to reschedule my appointment');
		expect(offered.outcome).toBe('offer_slots');
		expect((await harness.thread()).offeredSlots.map((slot) => slot.startAt)).toEqual(OFFERED);

		const picked = await harness.inbound('2');

		expect(picked.outcome).toBe('reschedule');
		// The SAME job moved — the calendar still holds exactly one appointment.
		const jobs = await harness.customerJobs();
		expect(jobs).toHaveLength(1);
		expect(jobs[0]?.id).toBe(jobId);
		expect(jobs[0]?.startAt).toBe(OFFERED[1]);
		// The reply names both windows (same-day move: the date once, times twice).
		const reply = harness.lastReply();
		expect(reply).toContain("You're moved!");
		expect(reply).toContain(
			'Water heater install — now Friday, July 3 at 9:00 AM (60 minutes), instead of 3:00 PM.',
		);
		// The thread now owns the booking it moved, offer retired.
		const thread = await harness.thread();
		expect(thread.state).toBe('booked');
		expect(thread.offeredSlots).toEqual([]);
		expect(thread.bookedJobId).toBe(jobId);
		// The team-facing note says what happened, in the transcript.
		expect(await harness.transcript()).toContain(
			`Rivus moved Water heater install from ${BOOKED_LABEL} to Friday, July 3 at 9:00 AM.`,
		);
	});

	it('moves the appointment when the customer suggests their own time instead of picking', async () => {
		const harness = await setup();
		app = harness.app;
		const jobId = await harness.book({ startAt: BOOKED_AT });
		await harness.inbound('I need to reschedule my appointment');

		const result = await harness.inbound('can you do Monday at 10am?');

		expect(result.outcome).toBe('reschedule');
		const jobs = await harness.customerJobs();
		expect(jobs).toHaveLength(1);
		expect(jobs[0]?.id).toBe(jobId);
		expect(jobs[0]?.startAt).toBe('2026-07-06T10:00:00.000Z');
		expect(harness.lastReply()).toContain(
			`Water heater install — now Monday, July 6 at 10:00 AM (60 minutes), instead of ${BOOKED_LABEL}.`,
		);
	});

	it('still books a second visit when the customer asks for one in so many words', async () => {
		const harness = await setup();
		app = harness.app;
		await harness.book({ startAt: BOOKED_AT });
		await harness.inbound('Can I get someone out to look at my water heater?');

		const result = await harness.inbound('can you also book another visit Monday at 10am?');

		expect(result.outcome).toBe('book');
		expect(harness.lastReply()).toContain("You're booked!");
		const jobs = await harness.customerJobs();
		expect(jobs).toHaveLength(2);
		expect(jobs.map((job) => job.startAt)).toContain(BOOKED_AT);
		expect(jobs.map((job) => job.startAt)).toContain('2026-07-06T10:00:00.000Z');
	});

	it('reads "also need to reschedule" as a move, never as an additional visit', async () => {
		const harness = await setup();
		app = harness.app;
		const jobId = await harness.book({ startAt: BOOKED_AT });
		await harness.inbound('Can I get someone out to look at my water heater?');

		// "also need" must not authorize a second booking when what follows it is
		// the reschedule itself — that reading re-creates the reported bug.
		const result = await harness.inbound('I also need to reschedule — can you do Monday at 10am?');

		expect(result.outcome).toBe('reschedule');
		const jobs = await harness.customerJobs();
		expect(jobs).toHaveLength(1);
		expect(jobs[0]?.id).toBe(jobId);
		expect(jobs[0]?.startAt).toBe('2026-07-06T10:00:00.000Z');
	});

	it('books exactly as before for a customer with nothing on the calendar', async () => {
		const harness = await setup();
		app = harness.app;
		await harness.inbound('Can I get someone out to look at my water heater?');

		const result = await harness.inbound('2');

		expect(result.outcome).toBe('book');
		const jobs = await harness.customerJobs();
		expect(jobs).toHaveLength(1);
		expect((await harness.thread()).state).toBe('booked');
	});

	it('hands the move to a human when the customer has more than one upcoming job', async () => {
		const harness = await setup();
		app = harness.app;
		await harness.book({ startAt: BOOKED_AT });
		await harness.book({ startAt: '2026-07-07T15:00:00.000Z', title: 'Annual service' });
		await harness.inbound('what times do you have this week?');

		const result = await harness.inbound('2');

		expect(result.outcome).toBe('reschedule_held');
		const reply = harness.lastReply();
		expect(reply).toContain('more than one appointment');
		expect(reply).toContain('Nothing on your calendar has changed.');
		// Nothing moved, nothing was added.
		const jobs = await harness.customerJobs();
		expect(jobs).toHaveLength(2);
		expect(jobs.map((job) => job.startAt).sort()).toEqual([BOOKED_AT, '2026-07-07T15:00:00.000Z']);
		// The team was paged, once.
		const conversation = await harness.repos.conversations.findById(
			harness.accountId,
			(await harness.thread()).conversationId,
		);
		expect(conversation?.status).toBe('needs_attention');
		expect(conversation?.flagReason).toContain('more than one upcoming job');
	});

	it('hands the move to a human when the only appointment is already under way', async () => {
		const harness = await setup();
		app = harness.app;
		// Started half an hour ago and still running.
		await harness.book({
			startAt: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
			status: 'in_progress',
		});
		await harness.inbound('Can I get someone out to look at my water heater?');
		await harness.inbound('reschedule it');

		const result = await harness.inbound('1');

		expect(result.outcome).toBe('reschedule_held');
		expect(harness.lastReply()).toContain("you're still booked for");
		expect(await harness.customerJobs()).toHaveLength(1);
	});

	it('re-validates the picked window at the job’s own duration and declines without moving', async () => {
		const harness = await setup();
		app = harness.app;
		// A two-hour install on Monday, and another customer's visit Tuesday 10:00.
		const jobId = await harness.book({
			startAt: '2026-07-06T13:00:00.000Z',
			durationMinutes: 120,
		});
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
			title: 'Someone elses visit',
			customerId: other.id,
			assignedUserId: '',
			startAt: '2026-07-07T10:00:00.000Z',
			durationMinutes: 60,
			status: 'confirmed',
			address: '',
			notes: '',
			estimatedValue: 0,
		});
		await harness.inbound('I need to reschedule my appointment');

		// 9:00 is free for a standard hour — but this job runs until 11:00, into
		// the other customer's visit.
		const declined = await harness.inbound('can you do tuesday at 9am?');

		expect(declined.outcome).toBe('reschedule_unavailable');
		const reply = harness.lastReply();
		expect(reply).toContain('Unfortunately Tuesday, July 7 at 9:00 AM was just taken.');
		expect(reply).toContain(
			"I haven't moved anything — you're still booked for Monday, July 6 at 1:00 PM.",
		);
		expect(reply).toContain('Here is what I could move you to instead:');
		// The alternatives were computed at the job's own duration and now stand as
		// the offer, so the next pick moves the two-hour job into a two-hour window.
		const offeredSlots = (await harness.thread()).offeredSlots;
		expect(offeredSlots.length).toBeGreaterThan(0);
		expect(offeredSlots.every((slot) => slot.durationMinutes === 120)).toBe(true);

		const moved = await harness.inbound('1');
		expect(moved.outcome).toBe('reschedule');
		const jobs = await harness.customerJobs();
		expect(jobs).toHaveLength(1);
		expect(jobs[0]?.id).toBe(jobId);
		expect(jobs[0]?.startAt).toBe(offeredSlots[0]?.startAt);
		expect(jobs[0]?.durationMinutes).toBe(120);
	});

	it('declines a window the job’s duration would run past closing time', async () => {
		const harness = await setup();
		app = harness.app;
		await harness.book({ startAt: '2026-07-06T13:00:00.000Z', durationMinutes: 120 });
		await harness.inbound('I need to reschedule my appointment');

		// 4:00 PM is a fine hour-long slot — but a two-hour job ends at 6:00 PM.
		const result = await harness.inbound('can you do thursday at 4pm?');

		expect(result.outcome).toBe('reschedule_unavailable');
		expect(harness.lastReply()).toContain('outside our business hours');
		expect(harness.lastReply()).toContain("you're still booked for Monday, July 6 at 1:00 PM.");
		expect((await harness.customerJobs())[0]?.startAt).toBe('2026-07-06T13:00:00.000Z');
	});

	it('confirms — not "just taken" — when a replayed pick finds the move already made', async () => {
		const harness = await setup();
		app = harness.app;
		const jobId = await harness.book({ startAt: BOOKED_AT });
		await harness.inbound('I need to reschedule my appointment');
		// The crash window: the job write landed but the confirmation never went
		// out, so the thread still holds the offer while the job already sits at
		// slot 2. The redelivered pick must confirm, not report its own job as
		// "just taken".
		await harness.repos.jobs.update(harness.accountId, jobId, { startAt: OFFERED[1] });

		const result = await harness.inbound('2');

		expect(result.outcome).toBe('confirm_existing');
		expect(harness.lastReply()).toContain("you're already booked for Friday, July 3 at 9:00 AM");
		const jobs = await harness.customerJobs();
		expect(jobs).toHaveLength(1);
		expect(jobs[0]?.startAt).toBe(OFFERED[1]);
	});

	it('moves into a window only the job itself occupies (the 1:00 → 2:00 shift)', async () => {
		const harness = await setup();
		app = harness.app;
		const jobId = await harness.book({
			startAt: '2026-07-06T13:00:00.000Z',
			durationMinutes: 120,
		});
		await harness.inbound('I need to reschedule my appointment');

		// 2:00 PM sits inside the job's own 1:00–3:00 window, so the standard
		// check reads it as taken — but the only thing there is the job itself.
		const result = await harness.inbound('can you do monday at 2pm?');

		expect(result.outcome).toBe('reschedule');
		const jobs = await harness.customerJobs();
		expect(jobs).toHaveLength(1);
		expect(jobs[0]?.id).toBe(jobId);
		expect(jobs[0]?.startAt).toBe('2026-07-06T14:00:00.000Z');
		expect(jobs[0]?.durationMinutes).toBe(120);
	});

	it('moves a half-hour job into a window the standard-length check would refuse', async () => {
		const harness = await setup();
		app = harness.app;
		const jobId = await harness.book({ startAt: BOOKED_AT, durationMinutes: 30 });
		await harness.inbound('I need to reschedule my appointment');

		// 4:30 PM fails the standard one-hour check (it would end at 5:30) but
		// fits a 30-minute job exactly.
		const result = await harness.inbound('can you do thursday at 4:30pm?');

		expect(result.outcome).toBe('reschedule');
		const jobs = await harness.customerJobs();
		expect(jobs).toHaveLength(1);
		expect(jobs[0]?.id).toBe(jobId);
		expect(jobs[0]?.startAt).toBe('2026-07-02T16:30:00.000Z');
		expect(jobs[0]?.durationMinutes).toBe(30);
	});

	it('keeps the plain decline when the picked window is truly taken by another job', async () => {
		const harness = await setup();
		app = harness.app;
		await harness.book({ startAt: BOOKED_AT });
		await harness.inbound('I need to reschedule my appointment');
		// The team books another customer into slot 2 after the offer went out.
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
			title: 'Someone elses visit',
			customerId: other.id,
			assignedUserId: '',
			startAt: OFFERED[1] ?? '',
			durationMinutes: 60,
			status: 'confirmed',
			address: '',
			notes: '',
			estimatedValue: 0,
		});

		const result = await harness.inbound('2');

		expect(result.outcome).toBe('propose_unavailable');
		expect(harness.lastReply()).toContain('was just taken');
		expect((await harness.customerJobs())[0]?.startAt).toBe(BOOKED_AT);
	});

	it('lets a move overlap the window it is vacating — its own, and only its own', async () => {
		const harness = await setup();
		app = harness.app;
		// Two hours at 1:00 PM; moving to noon overlaps 1:00–2:00 — with itself.
		const jobId = await harness.book({
			startAt: '2026-07-06T13:00:00.000Z',
			durationMinutes: 120,
		});
		await harness.inbound('I need to reschedule my appointment');

		const result = await harness.inbound('monday at 12pm works better');

		expect(result.outcome).toBe('reschedule');
		const jobs = await harness.customerJobs();
		expect(jobs).toHaveLength(1);
		expect(jobs[0]?.id).toBe(jobId);
		expect(jobs[0]?.startAt).toBe('2026-07-06T12:00:00.000Z');
		expect(jobs[0]?.durationMinutes).toBe(120);
	});

	it('restores the original time exactly when the confirmation cannot be sent', async () => {
		const harness = await setup();
		app = harness.app;
		const jobId = await harness.book({ startAt: BOOKED_AT });
		await harness.inbound('I need to reschedule my appointment');
		const slots = (await harness.thread()).offeredSlots;

		harness.sent.failNext = true;
		await expect(harness.inbound('2', 'redelivered-pick')).rejects.toThrow('SMS send failed');

		// A customer who never got the confirmation must not find their
		// appointment moved — and the thread must still be able to retry.
		const jobs = await harness.customerJobs();
		expect(jobs).toHaveLength(1);
		expect(jobs[0]?.id).toBe(jobId);
		expect(jobs[0]?.startAt).toBe(BOOKED_AT);
		const thread = await harness.thread();
		expect(thread.state).toBe('slots_offered');
		expect(thread.offeredSlots).toEqual(slots);

		// The provider redelivers the same message; this time it lands.
		const retried = await harness.inbound('2', 'redelivered-pick');
		expect(retried.outcome).toBe('reschedule');
		expect((await harness.customerJobs())[0]?.startAt).toBe(OFFERED[1]);
	});

	it('raises the same rescheduled notice a dispatcher move raises, to the assignee', async () => {
		const harness = await setup();
		app = harness.app;
		await harness.book({ startAt: BOOKED_AT, assignedUserId: harness.ownerId });
		await harness.inbound('I need to reschedule my appointment');

		const result = await harness.inbound('2');

		expect(result.outcome).toBe('reschedule');
		const { notifications } = await harness.repos.notifications.list({
			accountId: harness.accountId,
			userId: harness.ownerId,
			page: 1,
			pageSize: 10,
			unreadOnly: false,
		});
		expect(notifications.some((entry) => entry.title === 'A job was rescheduled')).toBe(true);
	});

	it('ends a voice call after a successful move, like a fresh booking does', () => {
		expect(VOICE_TERMINAL_OUTCOMES.has('reschedule')).toBe(true);
	});
});

import type {
	Account,
	AccountId,
	AgentThread,
	ConversationChannel,
	CreateJobInput,
	Customer,
	CustomerId,
	JobId,
	JobStatus,
} from '@rivus/core';
import type { UpdateAgentThread } from '../../repositories/types';
import type { AppDeps } from '../../types';
import { decideRivusReply } from '../inbox';
import { answerFromKnowledge } from '../knowledge';
import type { ChannelCapabilities, InboundAgentMessage } from './channel';
import { type AgentDecision, type BookedAppointment, decideScheduling } from './engine';
import {
	isAcknowledgement,
	matchOfferedSlot,
	parseProposedTime,
	parseRequestedDay,
	parseSlotChoice,
} from './parse';
import { isInformationalQuestion, namesBookingStatusQuestion } from './question';
import { type AgentReplyContext, type AgentResponse, composeAgentResponse } from './response';
import {
	BOOKING_HORIZON_DAYS,
	type BusyInterval,
	computeOpenSlots,
	formatSlotLabel,
	zonedParts,
} from './slots';

/**
 * The core agent's feature layer. A capability is the ONLY thing a new feature
 * adds: registered once in {@link defaultCapabilities}, it runs on every channel
 * the shared orchestrator drives (email, WhatsApp, and every future one) because
 * the orchestrator is channel-agnostic and the capability speaks only the
 * channel-neutral {@link AgentResponse}. No channel is edited to gain it.
 */

/** A 5xx-on-purpose: the provider must redeliver (an incomplete calendar, a failed send). */
export class RetryDeliveryError extends Error {
	readonly statusCode = 500;
	constructor(message: string) {
		super(message);
		this.name = 'RetryDeliveryError';
	}
}

/** The repositories + config a capability (and the orchestrator) may read. */
export type OrchestratorDeps = Pick<
	AppDeps,
	| 'config'
	| 'jobs'
	| 'conversations'
	| 'agentThreads'
	// Knowledge-base answering: the account's FAQs and the service that grounds an
	// answer in them.
	| 'faqs'
	| 'faqAnswer'
	// Handing a turn to a human: who to alert, and how.
	| 'memberships'
	| 'notifier'
>;

/** Everything a capability may read to decide and act on one customer turn. */
export interface TurnContext {
	account: Account;
	customer: Customer | null;
	thread: AgentThread;
	message: InboundAgentMessage;
	caps: ChannelCapabilities;
	timeZone: string;
	now: Date;
	/** Absolute self-signup URL, prefilled for this channel by the adapter. */
	signupUrl: string;
	/** The service title for a booking ("Water heater install" / "Appointment"). */
	jobTitle: string;
	deps: OrchestratorDeps;
}

/** Declarative side effects the ORCHESTRATOR executes (and rolls back on send failure). */
export interface CapabilitySideEffects {
	/** Create this job before delivering; deleted again if delivery fails. */
	bookJob?: CreateJobInput & {
		/** The inline transcript note recorded after a successful send. */
		note: string;
	};
	/**
	 * Flag the thread's conversation for human review and alert the team. Run
	 * AFTER a successful send, unlike `bookJob`: nothing about the reply depends
	 * on the flag existing first, and flagging afterwards means a failed delivery
	 * leaves no orphaned `needs_attention` behind for a turn the customer never
	 * saw. `pendingReply` may be empty — that is a question with no draft at all.
	 */
	flagForReview?: { pendingReply: string; flagReason: string };
}

export interface CapabilityOutcome {
	response: AgentResponse;
	/** Reported to the provider + logs ('offer_slots', 'book', …). */
	outcome: string;
	/** How the thread's machine state advances (the `bookedJobId` is filled by the orchestrator). */
	threadPatch: UpdateAgentThread;
	sideEffects?: CapabilitySideEffects;
}

/**
 * A core agent feature. `matches` claims a turn; `handle` produces a neutral
 * response + declarative effects. The orchestrator dispatches to the first
 * capability whose `matches` returns true (order = priority; the last must
 * always match), identically on every channel.
 */
export interface AgentCapability {
	readonly id: string;
	matches(ctx: TurnContext): boolean;
	handle(ctx: TurnContext): Promise<CapabilityOutcome>;
}

// How far ahead/back booked jobs are loaded when computing availability — the whole
// booking horizon (the engine declines proposals past it precisely because nothing
// beyond this window was fetched) plus slack for timezone edges, and a day back so an
// in-progress job (its startAt already past) still blocks same-day proposals.
const BUSY_WINDOW_DAYS = BOOKING_HORIZON_DAYS + 2;
const BUSY_LOOKBACK_MINUTES = 24 * 60;
// Backstop on calendar pages fetched per turn (100 jobs each). Far above any real
// account's ~9-week bookings; if hit, fail the delivery rather than book over unseen jobs.
const MAX_BUSY_PAGES = 100;

/** Booked (non-canceled) windows that could collide with a slot, paged out of the jobs repo. */
export async function loadBusyIntervals(
	jobs: OrchestratorDeps['jobs'],
	accountId: AccountId,
	now: Date,
): Promise<BusyInterval[]> {
	const from = new Date(now.getTime() - BUSY_LOOKBACK_MINUTES * 60_000).toISOString();
	const to = new Date(now.getTime() + BUSY_WINDOW_DAYS * 24 * 60 * 60_000).toISOString();
	const busy: BusyInterval[] = [];
	for (let page = 1; ; page += 1) {
		const { jobs: batch, total } = await jobs.list({ accountId, page, pageSize: 100, from, to });
		for (const job of batch) {
			if (job.status !== 'canceled') {
				busy.push({ startAt: job.startAt, durationMinutes: job.durationMinutes });
			}
		}
		if (page * 100 >= total || batch.length === 0) {
			break;
		}
		if (page >= MAX_BUSY_PAGES) {
			throw new RetryDeliveryError(
				'Calendar too large to load for availability; the delivery will be retried.',
			);
		}
	}
	return busy;
}

/** How each decision advances the thread's machine state (`bookedJobId` filled later). */
export function threadPatchFor(decision: AgentDecision): UpdateAgentThread {
	switch (decision.kind) {
		case 'send_signup_link':
			return { state: 'awaiting_signup', offeredSlots: [] };
		case 'offer_slots':
			return { state: 'slots_offered', offeredSlots: decision.slots };
		case 'confirm_existing':
			// The thread stays booked exactly as it was.
			return {};
		case 'propose_unavailable':
		case 'day_unavailable':
			// The alternatives were listed and numbered in the reply, so they become
			// the standing offer — a "2" back must still resolve to the second one.
			return decision.alternatives.length > 0
				? { state: 'slots_offered', offeredSlots: decision.alternatives }
				: { state: 'new', offeredSlots: [] };
		case 'no_availability':
			return { state: 'new', offeredSlots: [] };
		case 'greet':
			// Saying hello back moves nothing: the contact's next message starts from
			// wherever the thread already stood.
			return {};
		case 'book':
			return { state: 'booked', offeredSlots: [] };
		case 'answer_question':
			// Answering a question must leave scheduling exactly where it stood: a
			// standing offer keeps its slots (the reply re-listed them, so the numbers
			// must still resolve) and a booked thread stays booked. The single
			// exception is a contact the CRM doesn't know — the same reply pointed them
			// at self-signup, so the thread waits for that just as `send_signup_link`
			// leaves it. This is the ONE place that patch is decided.
			return decision.customerKnown ? {} : { state: 'awaiting_signup', offeredSlots: [] };
		case 'hold_for_team':
			// A human owns the answer now; the scheduling state is not theirs to move.
			return {};
		case 'booking_status':
			// Telling someone what they already have moves nothing. A standing offer
			// keeps its slots (the reply re-listed them, so the numbers must still
			// resolve) and a booked thread stays booked. The bookings themselves are
			// read from the calendar on every turn — deliberately not cached onto the
			// thread, so a job the team moves or cancels in the app is never reported
			// from a stale copy.
			return {};
		case 'no_booking':
			// The openings were listed and numbered in the reply, so they become the
			// standing offer — the same rule the two "that doesn't work" decisions
			// follow, and what makes a "2" back resolve to the second one.
			return decision.alternatives.length > 0
				? { state: 'slots_offered', offeredSlots: decision.alternatives }
				: { state: 'new', offeredSlots: [] };
	}
}

/** Everything the channel-neutral composer needs, read off the turn. */
function replyContextFor(ctx: TurnContext): AgentReplyContext {
	return {
		accountName: ctx.account.name,
		customerName: ctx.customer?.name ?? ctx.message.sender.name,
		timeZone: ctx.timeZone,
		signupUrl: ctx.signupUrl,
		jobTitle: ctx.jobTitle,
		now: ctx.now,
		medium: ctx.caps.medium,
	};
}

/** Human-readable channel name for the "Booked by Rivus over …" job note. */
function channelLabel(channel: ConversationChannel): string {
	switch (channel) {
		case 'email':
			return 'email';
		case 'whatsapp':
			return 'WhatsApp';
		case 'sms':
			return 'SMS';
		case 'phone':
			return 'phone';
	}
}

/**
 * The scheduling capability. Wraps the pure {@link decideScheduling} engine,
 * composes its decision into a neutral response, and declares a booking as a
 * side effect. `matches` is the always-on fallback, so it MUST stay last in the
 * registry: every turn no earlier capability claims lands here, which is what
 * keeps the agent from ever going silent. A future
 * `cancelCapability`/`rescheduleCapability` slots in ahead of it and instantly
 * works on every channel.
 */
export const schedulingCapability: AgentCapability = {
	id: 'scheduling',
	matches: () => true,
	async handle(ctx: TurnContext): Promise<CapabilityOutcome> {
		const { account, customer, thread, message, caps, timeZone, now, deps } = ctx;
		const busy = await loadBusyIntervals(deps.jobs, account.id, now);
		// The job already booked on this thread (while still upcoming and not called
		// off), so a bare "see you then!" confirms it instead of colliding with it.
		let bookedSlot = null;
		if (thread.state === 'booked' && thread.bookedJobId !== '') {
			const bookedJob = await deps.jobs.findById(account.id, thread.bookedJobId as JobId);
			if (
				bookedJob &&
				bookedJob.status !== 'canceled' &&
				Date.parse(bookedJob.startAt) + bookedJob.durationMinutes * 60_000 > now.getTime()
			) {
				bookedSlot = { startAt: bookedJob.startAt, durationMinutes: bookedJob.durationMinutes };
			}
		}

		const decision = decideScheduling({
			customerKnown: customer !== null,
			text: message.text,
			offeredSlots: thread.state === 'slots_offered' ? thread.offeredSlots : [],
			busy,
			timeZone,
			now,
			bookedSlot,
		});

		const response = composeAgentResponse(decision, replyContextFor(ctx));

		const outcome: CapabilityOutcome = {
			response,
			outcome: decision.kind,
			threadPatch: threadPatchFor(decision),
		};

		if (decision.kind === 'book' && customer) {
			const year = zonedParts(now, timeZone).year;
			outcome.sideEffects = {
				bookJob: {
					title: ctx.jobTitle,
					customerId: customer.id,
					assignedUserId: '',
					startAt: decision.slot.startAt,
					durationMinutes: decision.slot.durationMinutes,
					status: 'confirmed',
					address: customer.address,
					notes: `Booked by Rivus over ${channelLabel(caps.channel)} with ${customer.name}.`,
					estimatedValue: 0,
					note: `Rivus booked ${ctx.jobTitle} for ${formatSlotLabel(decision.slot.startAt, timeZone, year)}.`,
				},
			};
		}
		return outcome;
	},
};

/**
 * The knowledge capability: answer what the contact actually asked, from the
 * account's published FAQs, instead of pushing every message toward a booking.
 *
 * It sits AHEAD of scheduling in the registry, so its `matches` carries the
 * whole safety property: a turn the scheduling engine can already read is never
 * claimed here, no matter how much it looks like a question. Everything else
 * flows through the same two shared policies the inbox uses — one published-only
 * knowledge lookup ({@link answerFromKnowledge}) and one caution rule
 * ({@link decideRivusReply}) — so the agent and the "Let Rivus draft a reply"
 * button can never disagree about what is safe to send.
 */
export const knowledgeCapability: AgentCapability = {
	id: 'knowledge',
	matches(ctx: TurnContext): boolean {
		const { thread, message, timeZone, now } = ctx;
		// Exactly the inputs the engine would get, so "can scheduling read this?" is
		// answered by the same parsers that would then read it — the two can't drift.
		const offered = thread.state === 'slots_offered' ? thread.offeredSlots : [];
		if (
			parseSlotChoice(message.text, offered.length) !== null ||
			matchOfferedSlot(message.text, offered, timeZone) !== null ||
			parseProposedTime(message.text, { timeZone, now }) !== null ||
			// A named day is scheduling's to answer even with no time on it; today
			// `isInformationalQuestion` also refuses those, but the guard belongs here
			// so the parsers the engine uses stay the ones that decide.
			parseRequestedDay(message.text, { timeZone, now }) !== null ||
			isAcknowledgement(message.text)
		) {
			return false;
		}
		return isInformationalQuestion(message.text);
	},
	async handle(ctx: TurnContext): Promise<CapabilityOutcome> {
		const { account, customer, thread, message, deps } = ctx;
		const knowledge = await answerFromKnowledge(
			{ faqs: deps.faqs, faqAnswer: deps.faqAnswer },
			account.id,
			message.text,
		);
		// The inbox's caution policy, unchanged: a money question pauses even when
		// the knowledge base answered it, and an unanswerable one pauses with no draft.
		const held = decideRivusReply({
			customerMessage: message.text,
			answer: {
				answered: knowledge.answered,
				answer: knowledge.answer,
				sources: knowledge.sources.map((source) => source.id),
			},
		});
		const customerKnown = customer !== null;

		// A contact with no CRM record gets today's behavior when the answer can't
		// simply be sent (unanswerable, or money-sensitive): the signup link. Paging
		// the team about an unregistered number would turn every wrong-number text
		// into a notification, and there is no customer for them to follow up with.
		if (held.pause && !customerKnown) {
			return schedulingCapability.handle(ctx);
		}

		if (held.pause) {
			const decision: AgentDecision = { kind: 'hold_for_team' };
			return {
				response: composeAgentResponse(decision, replyContextFor(ctx)),
				outcome: decision.kind,
				threadPatch: threadPatchFor(decision),
				sideEffects: {
					flagForReview: { pendingReply: held.draft, flagReason: held.reason },
				},
			};
		}

		const decision: AgentDecision = {
			kind: 'answer_question',
			answer: held.draft,
			offeredSlots: thread.state === 'slots_offered' ? thread.offeredSlots : [],
			customerKnown,
		};
		return {
			response: composeAgentResponse(decision, replyContextFor(ctx)),
			outcome: decision.kind,
			threadPatch: threadPatchFor(decision),
		};
	},
};

/** The statuses that make a job an appointment worth telling a customer about. */
const REPORTABLE_JOB_STATUSES: ReadonlySet<JobStatus> = new Set([
	'scheduled',
	'confirmed',
	// A visit under way is still the answer to "when are you coming?" — the
	// alternative is telling someone with a tech at the door that they have
	// nothing booked. `completed` and `canceled` are excluded: neither is coming.
	'in_progress',
]);
/** How many appointments one answer lists before it says there are more. */
const MAX_REPORTED_BOOKINGS = 3;
/** Page size for the customer's-calendar query; a few pages cover any real customer. */
const BOOKING_PAGE_SIZE = 25;
/** Backstop mirroring {@link MAX_BUSY_PAGES}: fail the delivery rather than answer from a partial read. */
const MAX_BOOKING_PAGES = 100;

/**
 * The appointments this customer has coming up, soonest first, capped at
 * {@link MAX_REPORTED_BOOKINGS} (`more` reports whether the cap hid any).
 *
 * Read from the CRM rather than from the thread on purpose: a customer books
 * over the phone, the team enters the job in the app, and the next morning they
 * text "what appointment do I have coming up?" — that booking was never on this
 * thread, and answering "nothing" would be both wrong and an invitation to book
 * a second visit.
 *
 * Two bounds are deliberate. The query starts a lookback BEFORE now, because
 * `from` filters on `startAt` while "still coming" is about the window's end — a
 * job that started twenty minutes ago and runs another forty is still the
 * customer's next appointment. And it has no upper bound at all: nothing stops
 * the team booking six months out, and a horizon here would report that customer
 * as having nothing. It pages because `ListJobsOptions` carries a single status,
 * so the liveness filter can only run after the query: a customer with a screen
 * full of canceled rows (routine after a cancel-and-rebook) must not read as
 * having no appointment.
 */
export async function loadUpcomingBookings(
	jobs: OrchestratorDeps['jobs'],
	accountId: AccountId,
	customerId: CustomerId,
	now: Date,
): Promise<{ bookings: BookedAppointment[]; more: boolean }> {
	const from = new Date(now.getTime() - BUSY_LOOKBACK_MINUTES * 60_000).toISOString();
	const bookings: BookedAppointment[] = [];
	for (let page = 1; ; page += 1) {
		const { jobs: batch, total } = await jobs.list({
			accountId,
			customerId,
			page,
			pageSize: BOOKING_PAGE_SIZE,
			from,
		});
		for (const job of batch) {
			if (!REPORTABLE_JOB_STATUSES.has(job.status)) {
				continue;
			}
			if (Date.parse(job.startAt) + job.durationMinutes * 60_000 <= now.getTime()) {
				continue;
			}
			if (bookings.length === MAX_REPORTED_BOOKINGS) {
				// One past the cap is all it takes to know the list is short — the rest
				// of the calendar doesn't have to be read to say "and more after that".
				return { bookings, more: true };
			}
			bookings.push({
				title: job.title,
				startAt: job.startAt,
				durationMinutes: job.durationMinutes,
			});
		}
		if (page * BOOKING_PAGE_SIZE >= total || batch.length === 0) {
			break;
		}
		if (page >= MAX_BOOKING_PAGES) {
			throw new RetryDeliveryError(
				'Calendar too large to load bookings for this contact; the delivery will be retried.',
			);
		}
	}
	return { bookings, more: false };
}

/**
 * The booking-status capability: answer "what appointment do I have coming up?"
 * with the appointment, instead of pushing a contact who is already on the
 * calendar toward booking a second visit.
 *
 * It sits FIRST in the registry, and its `matches` carries the whole restraint —
 * the same shape `knowledgeCapability` uses. Registering it merely ahead of
 * scheduling would not be enough: "when are you coming?" carries no scheduling
 * vocabulary at all, so knowledge claims it today and answers it out of the FAQs
 * (or pages the team). The claim is lexical and state-aware only — whether a
 * booking actually exists is a repository read, which belongs in `handle`.
 */
export const bookingStatusCapability: AgentCapability = {
	id: 'booking_status',
	matches(ctx: TurnContext): boolean {
		const { thread, message, timeZone, now } = ctx;
		const offered = thread.state === 'slots_offered' ? thread.offeredSlots : [];
		// Two shapes are scheduling's however they are worded, and both are checked
		// with the parsers the engine itself would use, so the two can't drift: a
		// numbered pick of a standing offer, and a complete day + time (a proposal —
		// "can you do Tuesday at 2?" — which must book, not report).
		if (
			parseSlotChoice(message.text, offered.length) !== null ||
			parseProposedTime(message.text, { timeZone, now }) !== null ||
			isAcknowledgement(message.text)
		) {
			return false;
		}
		// `matchOfferedSlot` and `parseRequestedDay` are deliberately NOT guards
		// here, unlike in `knowledgeCapability`. Both read a bare day ("is my
		// appointment still on for Friday?"), and letting them win would answer a
		// question about an existing booking with openings on that day — or, while
		// an offer stands, silently book one of them off the back of a question.
		return namesBookingStatusQuestion(message.text);
	},
	async handle(ctx: TurnContext): Promise<CapabilityOutcome> {
		const { account, customer, thread, timeZone, now, deps } = ctx;
		// A contact the CRM doesn't know has no calendar to read: there is nothing to
		// look them up by, and no booking could have been made for them. Scheduling's
		// self-signup invitation is the right answer, so hand the turn over — the same
		// delegation the knowledge capability makes for a stranger it can't answer.
		if (!customer) {
			return schedulingCapability.handle(ctx);
		}

		const { bookings, more } = await loadUpcomingBookings(deps.jobs, account.id, customer.id, now);
		// A question asked mid-offer keeps the offer alive, numbers and all.
		const offeredSlots = thread.state === 'slots_offered' ? thread.offeredSlots : [];

		if (bookings.length > 0) {
			const decision: AgentDecision = { kind: 'booking_status', bookings, more, offeredSlots };
			return {
				response: composeAgentResponse(decision, replyContextFor(ctx)),
				outcome: decision.kind,
				threadPatch: threadPatchFor(decision),
			};
		}

		// Nothing booked. Say so plainly, then offer — a standing offer is restated
		// rather than recomputed, so the numbers the contact was already given keep
		// meaning the same windows.
		const alternatives =
			offeredSlots.length > 0
				? offeredSlots
				: computeOpenSlots({
						now,
						timeZone,
						busy: await loadBusyIntervals(deps.jobs, account.id, now),
					});
		const decision: AgentDecision = { kind: 'no_booking', alternatives };
		return {
			response: composeAgentResponse(decision, replyContextFor(ctx)),
			outcome: decision.kind,
			threadPatch: threadPatchFor(decision),
		};
	},
};

/**
 * The capability registry. Adding a feature = adding an entry here. Order is
 * priority, and each entry's `matches` carries its own restraint:
 * booking-status first (it claims only a question about a booking the contact
 * already has, and several of those phrasings are ones knowledge would otherwise
 * answer from the FAQs), knowledge next (it declines any turn scheduling can
 * read), and scheduling last as the always-matching fallback.
 */
export function defaultCapabilities(): AgentCapability[] {
	return [bookingStatusCapability, knowledgeCapability, schedulingCapability];
}

import type {
	Account,
	AccountId,
	AgentThread,
	ConversationChannel,
	CreateJobInput,
	Customer,
	JobId,
} from '@rivus/core';
import type { UpdateAgentThread } from '../../repositories/types';
import type { AppDeps } from '../../types';
import type { ChannelCapabilities, InboundAgentMessage } from './channel';
import { type AgentDecision, decideScheduling } from './engine';
import { type AgentResponse, composeAgentResponse } from './response';
import { BOOKING_HORIZON_DAYS, type BusyInterval, formatSlotLabel, zonedParts } from './slots';

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
export type OrchestratorDeps = Pick<AppDeps, 'config' | 'jobs' | 'conversations' | 'agentThreads'>;

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

/** How each scheduling decision advances the thread's machine state (`bookedJobId` filled later). */
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
			return decision.alternatives.length > 0
				? { state: 'slots_offered', offeredSlots: decision.alternatives }
				: { state: 'new', offeredSlots: [] };
		case 'no_availability':
			return { state: 'new', offeredSlots: [] };
		case 'book':
			return { state: 'booked', offeredSlots: [] };
	}
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
 * The v1 capability: scheduling. Wraps the pure {@link decideScheduling} engine,
 * composes its decision into a neutral response, and declares a booking as a
 * side effect. `matches` is the always-on fallback (it must be last in the
 * registry). A future `cancelCapability`/`rescheduleCapability` slots in ahead of
 * it and instantly works on every channel.
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

		const response = composeAgentResponse(decision, {
			accountName: account.name,
			customerName: customer?.name ?? message.sender.name,
			timeZone,
			signupUrl: ctx.signupUrl,
			jobTitle: ctx.jobTitle,
			now,
			medium: caps.medium,
		});

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

/** The v1 capability registry. Adding a feature = adding an entry here. */
export function defaultCapabilities(): AgentCapability[] {
	return [schedulingCapability];
}

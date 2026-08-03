import type { AgentSlot } from '@rivus/core';
import type { AgentDecision } from './engine';
import {
	formatDayLabel,
	formatSlotLabel,
	formatTimeLabel,
	isSameZonedDay,
	zonedParts,
} from './slots';

/**
 * The channel-neutral vocabulary every agent reply is composed from. These are
 * STRUCTURAL kinds (how content is shaped), never FEATURE kinds (what the agent
 * decided): a new feature reuses these blocks and touches no channel. Each
 * channel renderer switches exhaustively over this union, so a genuinely new
 * block kind is a compile error in every renderer at once (and the render-matrix
 * test fails until each handles it) — that is what makes "a core feature ships
 * on every channel" a structural guarantee rather than a convention.
 */
export type AgentResponseBlock =
	/** A short greeting line ("Hi Dana,"). */
	| { kind: 'greeting'; text: string }
	/** A body paragraph. May carry internal newlines (rendered as separate lines/paragraphs). */
	| { kind: 'paragraph'; text: string }
	/**
	 * An enumerated choice the contact picks from. `value` is the inbound text a
	 * pick sends back ('1', '2', …) — so an interactive channel (quick-reply
	 * buttons) and a plain one (a numbered list + "reply with the number")
	 * converge on the SAME inbound text, and core parsing works identically
	 * everywhere.
	 */
	| { kind: 'options'; items: Array<{ label: string; value: string }> }
	/** One call-to-action link. Rich channels render a button; plain ones a URL line. */
	| { kind: 'action'; label: string; url: string }
	/** A de-emphasized closing/notice line ("Need to change or cancel? …"). */
	| { kind: 'notice'; text: string }
	/**
	 * Verbatim free text — a human inbox reply or an approved FAQ draft, which has
	 * no scheduling decision behind it. Carries no agent chrome (greeting/sign-off).
	 */
	| { kind: 'freeText'; text: string };

/** A composed, channel-neutral agent reply: an ordered list of structural blocks. */
export interface AgentResponse {
	blocks: AgentResponseBlock[];
}

/** The medium a channel presents in — drives the few wording choices that vary. */
export type ChannelMedium = 'email' | 'chat' | 'voice';

/** Everything the core composer needs to word a decision, with no channel/provider detail. */
export interface AgentReplyContext {
	accountName: string;
	agentName: string;
	/** The matched customer's first-namable name; '' when the sender isn't recognized. */
	customerName: string;
	/** IANA zone slot labels are written in. */
	timeZone: string;
	/** Absolute self-signup URL (only used by `send_signup_link`). */
	signupUrl: string;
	/** The service being booked (only used by `book`). */
	jobTitle: string;
	/** The current instant — slot labels spell out a differing year. */
	now: Date;
	/** How the delivering channel presents, so the composer can pick medium-apt wording. */
	medium: ChannelMedium;
}

/** A response that is just free text (human inbox replies, approved FAQ drafts). */
export function freeTextResponse(body: string): AgentResponse {
	return { blocks: [{ kind: 'freeText', text: body }] };
}

/** "Hi Dana," / "Hi there," — first name only, matching how people write. */
function greeting(customerName: string): string {
	const first = customerName.trim().split(/\s+/)[0] ?? '';
	return first === '' ? 'Hi there,' : `Hi ${first},`;
}

/** The year "today" falls in for the account — labels omit it for same-year slots. */
function currentYearIn(context: AgentReplyContext): number {
	return zonedParts(context.now, context.timeZone).year;
}

function reasonSentence(
	reason: 'taken' | 'outside_hours' | 'in_past' | 'beyond_horizon',
	requestedLabel: string,
): string {
	switch (reason) {
		case 'taken':
			return `Unfortunately ${requestedLabel} was just taken.`;
		case 'outside_hours':
			return `Unfortunately ${requestedLabel} is outside our business hours (Monday to Friday, 9:00 AM to 5:00 PM).`;
		case 'in_past':
			return `Unfortunately ${requestedLabel} has already passed.`;
		case 'beyond_horizon':
			return `Unfortunately ${requestedLabel} is further out than I can schedule right now — I can book up to about two months ahead.`;
	}
}

function dayReasonSentence(
	reason: 'full' | 'closed' | 'in_past' | 'beyond_horizon',
	dayLabel: string,
): string {
	switch (reason) {
		case 'full':
			// Deliberately not "fully booked": `full` also covers a day whose remaining
			// hours are inside the notice window ("tomorrow?" asked at 5 PM), where
			// there is nothing to offer even though the calendar is empty.
			return `Unfortunately I don't have anything open on ${dayLabel}.`;
		case 'closed':
			return `Unfortunately we're closed on ${dayLabel} — our hours are Monday to Friday, 9:00 AM to 5:00 PM.`;
		case 'in_past':
			return `Unfortunately ${dayLabel} has already passed.`;
		case 'beyond_horizon':
			return `Unfortunately ${dayLabel} is further out than I can schedule right now — I can book up to about two months ahead.`;
	}
}

/**
 * The closing line when the agent has to decline and has nothing to put in the
 * declined time's place. Shared by every "that doesn't work" decision so they
 * can't drift into asking the same contact for times two different ways.
 */
function noAlternativesTrail(context: AgentReplyContext): string {
	return context.medium === 'voice'
		? `I couldn't find another opening in the next two weeks. Tell me a few times that work for you and I'll check them against ${context.accountName}'s calendar.`
		: `I couldn't find another opening in the next two weeks — reply with a few times that work for you and I'll check them against ${context.accountName}'s calendar.`;
}

/**
 * The closing line when the agent has openings to ask for rather than to give.
 * Shared by `no_availability` and by a status answer that found neither a
 * booking nor an opening, so the two can't drift.
 */
function proposeTimesTrail(context: AgentReplyContext): string {
	return context.medium === 'voice'
		? "Tell me a few times that work for you and I'll check them against the calendar."
		: "Reply with a few times that work for you and I'll check them against the calendar.";
}

/**
 * The closing line on a reply that leaves a standing booking alone. Shared by
 * `confirm_existing` and `booking_status`: both hand back a booking the contact
 * already has, and they must offer the same way out of it.
 */
function changeOrCancelTrail(context: AgentReplyContext): string {
	return context.medium === 'voice'
		? 'If you need to change or cancel, just call back anytime.'
		: 'If you need to change or cancel, just reply and let me know.';
}

/** How a contact is told to reply, worded for the medium. */
function replyHere(medium: ChannelMedium): string {
	if (medium === 'email') {
		return 'reply to this email';
	}
	return medium === 'voice' ? 'call back' : 'reply here';
}

/** How a contact picks an offered slot, worded for the medium. */
function pickAnOption(medium: ChannelMedium): string {
	return medium === 'voice'
		? 'Say the number that works for you, or suggest another time.'
		: 'Reply with the number that works for you, or suggest another time.';
}

/**
 * How a contact picks a window to MOVE to — {@link pickAnOption}'s move
 * sibling. "Move to" instead of "works for you": these numbers relocate the
 * booking they already have, and the trail must say so.
 */
function pickAMove(medium: ChannelMedium): string {
	return medium === 'voice'
		? "Say the number you'd like to move to, or suggest another time."
		: "Reply with the number you'd like to move to, or suggest another time.";
}

/**
 * The closing line after the agent has just booked or moved an appointment —
 * from here the team, not the agent, owns changes. Shared by `book` and
 * `reschedule` so the two confirmations can't drift.
 */
function teamHandlesChangesTrail(context: AgentReplyContext): string {
	return context.medium === 'voice'
		? `Need to change or cancel? Just call back and the ${context.accountName} team will take care of it.`
		: `Need to change or cancel? Reply here and the ${context.accountName} team will take care of it.`;
}

/**
 * The self-signup invitation for a contact the CRM doesn't know. Shared by
 * `send_signup_link` and by an answer to an unregistered contact, so the two
 * can't drift into telling the same person two different things.
 */
function signupInvitation(context: AgentReplyContext): string {
	return (
		`I don't see this ${context.medium === 'email' ? 'email address' : 'phone number'} in ${context.accountName}'s customer list yet. ` +
		(context.medium === 'voice'
			? `Add yourself in a minute at the web link I'll read out, then call back and I'll get you booked in.`
			: `Add yourself in a minute at the link below, then ${replyHere(context.medium)} and I'll get you booked in.`)
	);
}

/** The call-to-action that carries the prefilled self-signup link. */
function signupAction(context: AgentReplyContext): { label: string; url: string } {
	return { label: `Join ${context.accountName} as a customer`, url: context.signupUrl };
}

/** The intermediate shape of a decision's content, before it becomes blocks. */
interface DecisionContent {
	lead: string[];
	slots: AgentSlot[];
	action: { label: string; url: string } | null;
	trail: string[];
}

/** Map a scheduling decision to its channel-neutral content (the promoted `contentFor`). */
function contentFor(decision: AgentDecision, context: AgentReplyContext): DecisionContent {
	const year = currentYearIn(context);
	const none: Pick<DecisionContent, 'slots' | 'action'> = { slots: [], action: null };
	switch (decision.kind) {
		case 'send_signup_link':
			return {
				lead: [
					`Thanks for reaching out to ${context.accountName}! I'm ${context.agentName}, their scheduling assistant.`,
					signupInvitation(context),
				],
				slots: [],
				action: signupAction(context),
				trail: [],
			};
		case 'offer_slots':
			return {
				// An offer that answers a day-specific ask names that day, so the reply
				// visibly belongs to the question instead of reading as a generic list.
				lead: [
					decision.requestedDayStartAt
						? `Here is what ${context.accountName} has open on ${formatDayLabel(decision.requestedDayStartAt, context.timeZone, year)}:`
						: `Great to hear from you! Here are ${context.accountName}'s next openings:`,
				],
				slots: decision.slots,
				action: null,
				trail: [pickAnOption(context.medium)],
			};
		case 'book':
			return {
				lead: [
					"You're booked!",
					`${context.jobTitle} — ${formatSlotLabel(decision.slot.startAt, context.timeZone, year)} (${decision.slot.durationMinutes} minutes).`,
				],
				...none,
				trail: [teamHandlesChangesTrail(context)],
			};
		case 'reschedule': {
			// The old window is named in every variant (a misread ask must be visible
			// in the confirmation itself), but on a same-day move only its time — the
			// date is already on the new window, and repeating it reads (and on voice,
			// sounds) like two appointments.
			const sameDay = isSameZonedDay(decision.from.startAt, decision.to.startAt, context.timeZone);
			const fromLabel = sameDay
				? formatTimeLabel(decision.from.startAt, context.timeZone)
				: formatSlotLabel(decision.from.startAt, context.timeZone, year);
			if (context.medium === 'voice') {
				return {
					lead: [
						sameDay
							? `I've moved your ${decision.title} on ${formatDayLabel(decision.to.startAt, context.timeZone, year)} from ${fromLabel} to ${formatTimeLabel(decision.to.startAt, context.timeZone)}.`
							: `I've moved your ${decision.title} from ${fromLabel} to ${formatSlotLabel(decision.to.startAt, context.timeZone, year)}.`,
						`It's still ${decision.to.durationMinutes} minutes.`,
					],
					...none,
					trail: [teamHandlesChangesTrail(context)],
				};
			}
			return {
				lead: [
					"You're moved!",
					`${decision.title} — now ${formatSlotLabel(decision.to.startAt, context.timeZone, year)} (${decision.to.durationMinutes} minutes), instead of ${fromLabel}.`,
				],
				...none,
				trail: [teamHandlesChangesTrail(context)],
			};
		}
		case 'reschedule_unavailable': {
			// `reasonSentence` verbatim, then — in its own sentence, before anything
			// else — that nothing moved: a declined move that doesn't say the booking
			// still stands leaves the customer unsure whether they now have no time
			// at all.
			const requestedLabel = formatSlotLabel(decision.requestedStartAt, context.timeZone, year);
			const stillBooked = `I haven't moved anything — you're still booked for ${formatSlotLabel(decision.from.startAt, context.timeZone, year)}.`;
			if (decision.alternatives.length === 0) {
				return {
					lead: [reasonSentence(decision.reason, requestedLabel), stillBooked],
					...none,
					trail: [noAlternativesTrail(context)],
				};
			}
			return {
				lead: [
					reasonSentence(decision.reason, requestedLabel),
					stillBooked,
					'Here is what I could move you to instead:',
				],
				slots: decision.alternatives,
				action: null,
				trail: [pickAMove(context.medium)],
			};
		}
		case 'reschedule_held':
			return {
				lead: decision.slot
					? [
							`I've passed this one to the ${context.accountName} team — they'll follow up shortly to get it moved.`,
							`Nothing has changed in the meantime: you're still booked for ${formatSlotLabel(decision.slot.startAt, context.timeZone, year)}.`,
						]
					: [
							`It looks like you have more than one appointment with us, so I've passed this to the ${context.accountName} team rather than move the wrong one. They'll follow up shortly.`,
							'Nothing on your calendar has changed.',
						],
				...none,
				trail: [
					// A caller is still on the line, so "call back" (what `replyHere`
					// says for voice) would be the wrong instruction here.
					context.medium === 'voice'
						? "If there's anything else in the meantime, just tell me."
						: `If there's anything else in the meantime, just ${replyHere(context.medium)}.`,
				],
			};
		case 'confirm_existing':
			return {
				lead: [
					`You're all set — you're already booked for ${formatSlotLabel(decision.slot.startAt, context.timeZone, year)}.`,
				],
				...none,
				trail: [changeOrCancelTrail(context)],
			};
		case 'propose_unavailable': {
			const requestedLabel = formatSlotLabel(decision.requestedStartAt, context.timeZone, year);
			if (decision.alternatives.length === 0) {
				return {
					lead: [reasonSentence(decision.reason, requestedLabel)],
					...none,
					trail: [noAlternativesTrail(context)],
				};
			}
			return {
				lead: [reasonSentence(decision.reason, requestedLabel), 'Here is what we do have open:'],
				slots: decision.alternatives,
				action: null,
				trail: [pickAnOption(context.medium)],
			};
		}
		case 'day_unavailable': {
			// Same shape as `propose_unavailable`, one day wide: say why the day they
			// named is out, then move straight to what they can actually have.
			const dayLabel = formatDayLabel(decision.requestedDayStartAt, context.timeZone, year);
			if (decision.alternatives.length === 0) {
				return {
					lead: [dayReasonSentence(decision.reason, dayLabel)],
					...none,
					trail: [noAlternativesTrail(context)],
				};
			}
			return {
				lead: [dayReasonSentence(decision.reason, dayLabel), 'Here is what we do have open:'],
				slots: decision.alternatives,
				action: null,
				trail: [pickAnOption(context.medium)],
			};
		}
		case 'no_availability':
			return {
				lead: [
					`Thanks for reaching out! ${context.accountName}'s calendar is fully booked for the next two weeks.`,
				],
				...none,
				trail: [proposeTimesTrail(context)],
			};
		case 'greet':
			// Deliberately slot-free: the contact said hello and nothing else, so the
			// reply names what the agent can do and hands the turn straight back.
			return {
				lead: [
					`Thanks for reaching out to ${context.accountName}! I'm ${context.agentName}, their assistant — I can book you an appointment or answer questions about ${context.accountName}.`,
				],
				...none,
				trail: [
					context.medium === 'voice'
						? 'Just tell me what you need.'
						: `Just ${replyHere(context.medium)} with what you need.`,
				],
			};
		case 'answer_question': {
			// A question asked mid-offer must not cost the contact their options, so
			// the standing offer is restated verbatim — same slots, same order, so the
			// numbers they were given still mean the same windows.
			if (decision.offeredSlots.length > 0) {
				return {
					lead: [decision.answer, 'The times I offered are still open:'],
					slots: decision.offeredSlots,
					action: null,
					trail: [pickAnOption(context.medium)],
				};
			}
			// An unrecognized contact gets the answer *and* the way to become a
			// customer — answering a stranger's question is free, booking for them is not.
			if (!decision.customerKnown) {
				return {
					lead: [decision.answer, signupInvitation(context)],
					slots: [],
					action: signupAction(context),
					trail: [],
				};
			}
			return {
				lead: [decision.answer],
				...none,
				trail: [
					// A caller is still on the line, so "call back" (what `replyHere`
					// says for voice) would be the wrong instruction here.
					context.medium === 'voice'
						? "Want to book a time? Just say the word and I'll find you an opening."
						: `Want to book a time? Just ${replyHere(context.medium)} and I'll find you an opening.`,
				],
			};
		}
		case 'hold_for_team':
			// No slots here on purpose: the contact asked a question, and answering it
			// with appointment times is the very thing that goes wrong when the agent
			// treats every unparseable message as a booking request.
			return {
				lead: [
					`Good question — I don't have that in front of me, so I've passed it to the ${context.accountName} team. They'll follow up with you shortly.`,
				],
				...none,
				trail: [`If there's anything else in the meantime, just ${replyHere(context.medium)}.`],
			};
		case 'booking_status': {
			// The whole answer is the appointment itself, written the same way a fresh
			// booking is confirmed ("Water heater install — Tuesday, July 7 at 9:00 AM
			// (60 minutes)."), so a customer reading both sees one agent.
			const lead = [
				`Here's what you have coming up with ${context.accountName}:`,
				...decision.bookings.map(
					(booking) =>
						`${booking.title} — ${formatSlotLabel(booking.startAt, context.timeZone, year)} (${booking.durationMinutes} minutes).`,
				),
			];
			// A capped list must say it is capped: "that's everything" is the one thing
			// this reply must never imply when the calendar holds more.
			if (decision.more) {
				lead.push(
					`Those are the next ${decision.bookings.length} — ${replyHere(context.medium)} if you'd like the rest.`,
				);
			}
			// Answering mid-offer must not cost the contact their options, exactly as
			// `answer_question` restates them: same slots, same order, same numbers.
			if (decision.offeredSlots.length > 0) {
				return {
					lead: [...lead, 'The times I offered are still open:'],
					slots: decision.offeredSlots,
					action: null,
					trail: [pickAnOption(context.medium)],
				};
			}
			return { lead, ...none, trail: [changeOrCancelTrail(context)] };
		}
		case 'no_booking':
			// Saying plainly that nothing is booked is the point: a contact who asked
			// what they have and got only a list of openings can't tell whether the
			// agent looked. The openings still follow, so the turn stays useful.
			if (decision.alternatives.length === 0) {
				return {
					lead: [
						`I don't see anything booked for you with ${context.accountName} right now.`,
						"I couldn't find an opening in the next two weeks either.",
					],
					...none,
					trail: [proposeTimesTrail(context)],
				};
			}
			return {
				lead: [
					`I don't see anything booked for you with ${context.accountName} right now.`,
					'Here is what we do have open:',
				],
				slots: decision.alternatives,
				action: null,
				trail: [pickAnOption(context.medium)],
			};
		case 'booking_choice':
			return {
				lead: [
					`You already have ${decision.booking.title} coming up on ${formatSlotLabel(decision.booking.startAt, context.timeZone, year)} (${decision.booking.durationMinutes} minutes).`,
					'Do you want to reschedule that appointment, keep it as-is, or add another appointment?',
				],
				...none,
				trail: [
					context.medium === 'voice'
						? 'Say reschedule, keep it, or add another appointment.'
						: 'Reply with reschedule, keep it, or add another appointment.',
				],
			};
	}
}

/**
 * The one place decision kinds become content — the switch that used to live
 * inside `email/templates.ts` `contentFor`, promoted to the channel-agnostic
 * core. Adding or changing a decision kind edits ONLY this function; every
 * channel renders the resulting blocks without a change.
 */
export function composeAgentResponse(
	decision: AgentDecision,
	context: AgentReplyContext,
): AgentResponse {
	const content = contentFor(decision, context);
	const blocks: AgentResponseBlock[] = [{ kind: 'greeting', text: greeting(context.customerName) }];
	if (content.lead.length > 0) {
		blocks.push({ kind: 'paragraph', text: content.lead.join('\n') });
	}
	if (content.slots.length > 0) {
		const year = currentYearIn(context);
		blocks.push({
			kind: 'options',
			items: content.slots.map((slot, index) => ({
				label: formatSlotLabel(slot.startAt, context.timeZone, year),
				value: String(index + 1),
			})),
		});
	}
	if (content.action) {
		blocks.push({ kind: 'action', label: content.action.label, url: content.action.url });
	}
	if (content.trail.length > 0) {
		blocks.push({ kind: 'notice', text: content.trail.join('\n') });
	}
	return { blocks };
}

/** One block → its plain-text form (a numbered option list, a URL line, …). */
function blockText(block: AgentResponseBlock): string {
	switch (block.kind) {
		case 'greeting':
		case 'paragraph':
		case 'notice':
		case 'freeText':
			return block.text;
		case 'options':
			return block.items.map((item) => `${item.value}. ${item.label}`).join('\n');
		case 'action':
			return `${block.label}: ${block.url}`;
	}
}

/**
 * The canonical plain-text flattening of a response — blank line between blocks —
 * the universal fallback every channel can produce and the basis of chat/voice
 * rendering. Channel chrome (an email sign-off, a footer) is renderer-owned
 * presentation, not content, so it stays out of this function.
 */
export function renderResponseText(response: AgentResponse): string {
	return response.blocks.map(blockText).join('\n\n');
}

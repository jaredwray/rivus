import type { AgentSlot } from '@rivus/core';
import type { AgentDecision } from './engine';
import { formatSlotLabel, zonedParts } from './slots';

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
					`Thanks for reaching out to ${context.accountName}! I'm Rivus, their scheduling assistant.`,
					signupInvitation(context),
				],
				slots: [],
				action: signupAction(context),
				trail: [],
			};
		case 'offer_slots':
			return {
				lead: [`Great to hear from you! Here are ${context.accountName}'s next openings:`],
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
				trail: [
					context.medium === 'voice'
						? `Need to change or cancel? Just call back and the ${context.accountName} team will take care of it.`
						: `Need to change or cancel? Reply here and the ${context.accountName} team will take care of it.`,
				],
			};
		case 'confirm_existing':
			return {
				lead: [
					`You're all set — you're already booked for ${formatSlotLabel(decision.slot.startAt, context.timeZone, year)}.`,
				],
				...none,
				trail: [
					context.medium === 'voice'
						? 'If you need to change or cancel, just call back anytime.'
						: 'If you need to change or cancel, just reply and let me know.',
				],
			};
		case 'propose_unavailable': {
			const requestedLabel = formatSlotLabel(decision.requestedStartAt, context.timeZone, year);
			if (decision.alternatives.length === 0) {
				return {
					lead: [reasonSentence(decision.reason, requestedLabel)],
					...none,
					trail: [
						context.medium === 'voice'
							? `I couldn't find another opening in the next two weeks. Tell me a few times that work for you and I'll check them against ${context.accountName}'s calendar.`
							: `I couldn't find another opening in the next two weeks — reply with a few times that work for you and I'll check them against ${context.accountName}'s calendar.`,
					],
				};
			}
			return {
				lead: [reasonSentence(decision.reason, requestedLabel), 'Here is what we do have open:'],
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
				trail: [
					context.medium === 'voice'
						? "Tell me a few times that work for you and I'll check them against the calendar."
						: "Reply with a few times that work for you and I'll check them against the calendar.",
				],
			};
		case 'greet':
			// Deliberately slot-free: the contact said hello and nothing else, so the
			// reply names what the agent can do and hands the turn straight back.
			return {
				lead: [
					`Thanks for reaching out to ${context.accountName}! I'm Rivus, their assistant — I can book you an appointment or answer questions about ${context.accountName}.`,
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
			// numbers they were given still mean the same windows. The wording claims
			// nothing about those windows still being free: nobody re-checked the
			// calendar to answer a question, and the pick that follows re-checks it
			// anyway (declining with alternatives if one was taken meanwhile).
			if (decision.offeredSlots.length > 0) {
				return {
					lead: [decision.answer, "When you're ready, here are the times I offered:"],
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
				trail: [
					// The caller is still connected and the line stays open for another
					// turn, so "call back" (what `replyHere` says for voice) would be the
					// wrong instruction — same adjacency as the answer above.
					context.medium === 'voice'
						? "If there's anything else in the meantime, just tell me."
						: `If there's anything else in the meantime, just ${replyHere(context.medium)}.`,
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

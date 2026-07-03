import type { AgentSlot } from '@rivus/core';
import { escapeHtml, type RenderedEmail } from '../../email';
import type { AgentDecision } from '../engine';
import { formatSlotLabel, zonedParts } from '../slots';
import { cleanSubject } from './inbound';

/**
 * Rendering of the agent's scheduling decisions as email. Every visual value
 * here comes from DESIGN_SYSTEM.md — Montserrat, the surface/hairline/text
 * tokens, 14px cards, and the signature gradient reserved for the one
 * Rivus-the-agent action button. The plain-text body doubles as the message
 * recorded on the inbox conversation, so it must read well on its own.
 */

export interface AgentEmailRenderContext {
	accountName: string;
	/** The matched customer's name; '' when the sender isn't recognized. */
	customerName: string;
	/** IANA zone slot labels are written in. */
	timeZone: string;
	/** Absolute self-signup URL (only used by `send_signup_link`). */
	signupUrl: string;
	/** The service being booked (only used by `book`). */
	jobTitle: string;
	/** The inbound email's subject, verbatim ('' when none). */
	inboundSubject: string;
	/**
	 * The current instant — slot labels spell out the year whenever a slot falls
	 * in a different year than this, so a January booking written in December can
	 * never read as this week's.
	 */
	now: Date;
}

/** `Re:` the customer's own subject, or a sensible thread-starter without one. */
export function replySubject(inboundSubject: string, accountName: string): string {
	const cleaned = cleanSubject(inboundSubject);
	return cleaned === '' ? `Scheduling with ${accountName}` : `Re: ${cleaned}`;
}

/** "Hi Dana," / "Hi there," — first name only, matching how people write email. */
function greeting(customerName: string): string {
	const first = customerName.trim().split(/\s+/)[0] ?? '';
	return first === '' ? 'Hi there,' : `Hi ${first},`;
}

const FOOTER_NOTE = (accountName: string) =>
	`Rivus · AI scheduling for ${accountName}. Reply to this email and I'll take care of it.`;

/** The year "today" falls in for the account — labels omit it for same-year slots. */
function currentYearIn(context: AgentEmailRenderContext): number {
	return zonedParts(context.now, context.timeZone).year;
}

/** The numbered "reply with 1/2/3" list, in text and HTML forms. */
function slotLines(slots: AgentSlot[], context: AgentEmailRenderContext): string[] {
	const year = currentYearIn(context);
	return slots.map(
		(slot, index) => `${index + 1}. ${formatSlotLabel(slot.startAt, context.timeZone, year)}`,
	);
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

interface EmailContent {
	/** Paragraphs before the list/button. */
	lead: string[];
	/** Numbered options, when the reply offers times. */
	options: string[];
	/** Paragraphs after the list/button. */
	trail: string[];
	/** The one gradient action button, when the reply carries a link. */
	button: { label: string; url: string } | null;
}

function contentFor(decision: AgentDecision, context: AgentEmailRenderContext): EmailContent {
	switch (decision.kind) {
		case 'send_signup_link':
			return {
				lead: [
					`Thanks for reaching out to ${context.accountName}! I'm Rivus, their scheduling assistant.`,
					`I don't see this email address in ${context.accountName}'s customer list yet. Add yourself in a minute at the link below, then reply to this email and I'll get you booked in.`,
				],
				options: [],
				trail: [],
				button: { label: `Join ${context.accountName} as a customer`, url: context.signupUrl },
			};
		case 'offer_slots':
			return {
				lead: [`Great to hear from you! Here are ${context.accountName}'s next openings:`],
				options: slotLines(decision.slots, context),
				trail: ['Reply with the number that works for you, or suggest another time.'],
				button: null,
			};
		case 'book':
			return {
				lead: [
					"You're booked!",
					`${context.jobTitle} — ${formatSlotLabel(decision.slot.startAt, context.timeZone, currentYearIn(context))} (${decision.slot.durationMinutes} minutes).`,
				],
				options: [],
				trail: [
					// Changes are a human's call (a "move it to Friday" reply would book a
					// second appointment, not move this one) — and every reply lands in the
					// team inbox, so pointing at the team is both honest and true.
					`Need to change or cancel? Reply here and the ${context.accountName} team will take care of it.`,
				],
				button: null,
			};
		case 'confirm_existing':
			return {
				lead: [
					`You're all set — you're already booked for ${formatSlotLabel(decision.slot.startAt, context.timeZone, currentYearIn(context))}.`,
				],
				options: [],
				trail: ['If you need to change or cancel, just reply and let me know.'],
				button: null,
			};
		case 'propose_unavailable': {
			const requestedLabel = formatSlotLabel(
				decision.requestedStartAt,
				context.timeZone,
				currentYearIn(context),
			);
			if (decision.alternatives.length === 0) {
				return {
					lead: [reasonSentence(decision.reason, requestedLabel)],
					options: [],
					trail: [
						`I couldn't find another opening in the next two weeks — reply with a few times that work for you and I'll check them against ${context.accountName}'s calendar.`,
					],
					button: null,
				};
			}
			return {
				lead: [reasonSentence(decision.reason, requestedLabel), 'Here is what we do have open:'],
				options: slotLines(decision.alternatives, context),
				trail: ['Reply with the number that works for you, or suggest another time.'],
				button: null,
			};
		}
		case 'no_availability':
			return {
				lead: [
					`Thanks for reaching out! ${context.accountName}'s calendar is fully booked for the next two weeks.`,
				],
				options: [],
				trail: [
					"Reply with a few times that work for you and I'll check them against the calendar.",
				],
				button: null,
			};
	}
}

/** The plain-text body — also what the inbox conversation records for this turn. */
export function renderAgentReplyText(
	decision: AgentDecision,
	context: AgentEmailRenderContext,
): string {
	const content = contentFor(decision, context);
	const parts: string[] = [greeting(context.customerName), '', ...content.lead];
	if (content.options.length > 0) {
		parts.push('', ...content.options);
	}
	if (content.button) {
		parts.push('', `${content.button.label}: ${content.button.url}`);
	}
	if (content.trail.length > 0) {
		parts.push('', ...content.trail);
	}
	parts.push('', `— Rivus, scheduling for ${context.accountName}`);
	return parts.join('\n');
}

// Design-system tokens (DESIGN_SYSTEM.md): Montserrat with system fallbacks
// for clients that won't load web fonts, surfaces, hairline, text colors, and
// the signature gradient — reserved for the single Rivus-the-agent button.
const FONT_STACK = "Montserrat, -apple-system, 'Segoe UI', Roboto, sans-serif";
const PAGE_BG = '#f6f7fb';
const CARD_BG = '#ffffff';
const HAIRLINE = '#e9eaf0';
const TEXT_PRIMARY = '#16161f';
const TEXT_SUB = '#8a8b99';
const GRADIENT = 'linear-gradient(135deg, #1ebefa, #6e1ec8)';

/** One body paragraph in the shared card style (its text is HTML-escaped). */
function paragraph(line: string): string {
	return `<p style="margin: 0 0 12px; font-size: 13.5px; line-height: 1.6; color: ${TEXT_PRIMARY};">${escapeHtml(line)}</p>`;
}

/**
 * Wrap already-rendered body fragments in the shared design-system chrome — the
 * page background, the account-headed card, and the Rivus footer — so every
 * agent email (a scheduling decision or a plain reply) looks like one thread.
 */
function emailShell(accountName: string, body: string[]): string {
	return [
		'<!doctype html>',
		'<html lang="en">',
		`<body style="margin: 0; padding: 24px 12px; background: ${PAGE_BG}; font-family: ${FONT_STACK};">`,
		`<div style="max-width: 560px; margin: 0 auto; background: ${CARD_BG}; border: 1px solid ${HAIRLINE}; border-radius: 14px; padding: 24px;">`,
		`<p style="margin: 0 0 16px; font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: ${TEXT_SUB};">${escapeHtml(accountName)}</p>`,
		...body,
		'</div>',
		`<p style="max-width: 560px; margin: 12px auto 0; font-size: 11.5px; font-weight: 500; color: ${TEXT_SUB}; text-align: center;">${escapeHtml(FOOTER_NOTE(accountName))}</p>`,
		'</body>',
		'</html>',
	].join('\n');
}

/** Render a decision as a full email (subject + design-system HTML + text). */
export function renderAgentEmail(
	decision: AgentDecision,
	context: AgentEmailRenderContext,
): RenderedEmail {
	const content = contentFor(decision, context);
	const subject = replySubject(context.inboundSubject, context.accountName);
	const text = renderAgentReplyText(decision, context);

	const body: string[] = [
		paragraph(greeting(context.customerName)),
		...content.lead.map(paragraph),
	];
	if (content.options.length > 0) {
		const items = content.options
			.map(
				(option) =>
					`<li style="margin: 0 0 8px; font-size: 13.5px; line-height: 1.6; color: ${TEXT_PRIMARY}; font-weight: 600;">${escapeHtml(option.replace(/^\d+\.\s*/, ''))}</li>`,
			)
			.join('\n');
		body.push(`<ol style="margin: 0 0 12px; padding-left: 20px;">${items}</ol>`);
	}
	if (content.button) {
		body.push(
			`<p style="margin: 16px 0;"><a href="${escapeHtml(content.button.url)}" ` +
				`style="display: inline-block; padding: 12px 22px; background: ${GRADIENT}; ` +
				`color: #ffffff; border-radius: 11px; text-decoration: none; font-weight: 600; ` +
				`font-size: 13.5px;">${escapeHtml(content.button.label)}</a></p>`,
			`<p style="margin: 0 0 12px; font-size: 11.5px; color: ${TEXT_SUB};">Or paste this link into your browser:<br>` +
				`<a href="${escapeHtml(content.button.url)}" style="color: ${TEXT_SUB};">${escapeHtml(content.button.url)}</a></p>`,
		);
	}
	body.push(...content.trail.map(paragraph));

	return { subject, html: emailShell(context.accountName, body), text };
}

/**
 * Render a free-text reply into an email thread: a human team member's message
 * from the inbox, or an approved Rivus draft. There's no scheduling decision
 * behind it — the body is whatever was written — so it carries no slot list or
 * action button, but it wears the same `Re:` subject and design-system card as
 * the agent's own replies, so the customer sees one consistent thread. The
 * writer's paragraph and line breaks are preserved; every line is HTML-escaped.
 */
export function renderReplyEmail(context: {
	accountName: string;
	/** The email thread's subject, so the reply threads under `Re: …`. */
	inboundSubject: string;
	/** The reply text, exactly as the human wrote it (or the approved draft). */
	body: string;
}): RenderedEmail {
	const subject = replySubject(context.inboundSubject, context.accountName);
	// A blank line separates paragraphs; single breaks within one become <br>.
	const paragraphs = context.body
		.split(/\n{2,}/)
		.map((block) =>
			block
				.split(/\n/)
				.map((line) => escapeHtml(line))
				.join('<br>'),
		)
		.filter((block) => block.trim() !== '')
		.map(
			(block) =>
				`<p style="margin: 0 0 12px; font-size: 13.5px; line-height: 1.6; color: ${TEXT_PRIMARY};">${block}</p>`,
		);
	return { subject, html: emailShell(context.accountName, paragraphs), text: context.body };
}

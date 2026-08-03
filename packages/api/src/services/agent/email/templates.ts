import type { RenderedEmail } from '../../email';
import type { AgentDecision } from '../engine';
import { composeAgentResponse, freeTextResponse } from '../response';
import { renderEmailResponse, replySubject } from './renderer';

/**
 * Backward-compatible email rendering wrappers. The scheduling copy and the
 * design-system chrome moved to the channel-agnostic composer (`../response.ts`)
 * and the email renderer (`./renderer.ts`); these thin adapters keep the prior
 * `renderAgentEmail`/`renderAgentReplyText`/`renderReplyEmail` API (and its
 * exact output) so the pinned template tests — the byte-parity proof for the
 * refactor — keep compiling and passing unchanged.
 */

export interface AgentEmailRenderContext {
	accountName: string;
	agentName: string;
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
	 * The current instant — slot labels spell out the year whenever a slot falls in
	 * a different year than this.
	 */
	now: Date;
}

export { replySubject };

/** Compose a decision into a neutral response worded for the email medium. */
function toEmailResponse(decision: AgentDecision, context: AgentEmailRenderContext) {
	return composeAgentResponse(decision, {
		accountName: context.accountName,
		agentName: context.agentName,
		customerName: context.customerName,
		timeZone: context.timeZone,
		signupUrl: context.signupUrl,
		jobTitle: context.jobTitle,
		now: context.now,
		medium: 'email',
	});
}

/** Render a decision as a full email (subject + design-system HTML + text). */
export function renderAgentEmail(
	decision: AgentDecision,
	context: AgentEmailRenderContext,
): RenderedEmail {
	return renderEmailResponse(toEmailResponse(decision, context), {
		accountName: context.accountName,
		agentName: context.agentName,
		inboundSubject: context.inboundSubject,
	});
}

/** The plain-text body — also what the inbox conversation records for this turn. */
export function renderAgentReplyText(
	decision: AgentDecision,
	context: AgentEmailRenderContext,
): string {
	return renderAgentEmail(decision, context).text;
}

/**
 * Render a free-text reply into an email thread (a human team member's message
 * from the inbox, or an approved Rivus draft): the same `Re:` subject and card as
 * the agent's own replies, with no slot list, button, or sign-off.
 */
export function renderReplyEmail(context: {
	accountName: string;
	agentName: string;
	inboundSubject: string;
	body: string;
}): RenderedEmail {
	return renderEmailResponse(freeTextResponse(context.body), {
		accountName: context.accountName,
		agentName: context.agentName,
		inboundSubject: context.inboundSubject,
	});
}

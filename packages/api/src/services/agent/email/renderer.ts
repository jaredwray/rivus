import { escapeHtml, type RenderedEmail } from '../../email';
import { type AgentResponse, renderResponseText } from '../response';
import { cleanSubject } from '../subject';

/**
 * The email channel's ONE generic renderer: any {@link AgentResponse} → the
 * design-system HTML card + plain text + subject. It switches exhaustively on the
 * neutral block kinds and knows only chrome (the shell, the footer) — never a
 * scheduling decision — so a new core feature renders here with no change. Every visual value is a DESIGN_SYSTEM.md token (Montserrat, the
 * surface/hairline/text colors, the 14px card, and the signature gradient
 * reserved for the single Rivus-the-agent button).
 */

const FONT_STACK = "Montserrat, -apple-system, 'Segoe UI', Roboto, sans-serif";
const PAGE_BG = '#f6f7fb';
const CARD_BG = '#ffffff';
const HAIRLINE = '#e9eaf0';
const TEXT_PRIMARY = '#16161f';
const TEXT_SUB = '#8a8b99';
const GRADIENT = 'linear-gradient(135deg, #1ebefa, #6e1ec8)';

const FOOTER_NOTE = (accountName: string, agentName: string) =>
	`${agentName} · AI scheduling for ${accountName}. Reply to this email and I'll take care of it.`;

/** `Re:` the customer's own subject, or a sensible thread-starter without one. */
export function replySubject(inboundSubject: string, accountName: string): string {
	const cleaned = cleanSubject(inboundSubject);
	return cleaned === '' ? `Scheduling with ${accountName}` : `Re: ${cleaned}`;
}

/** One body paragraph in the shared card style (its text is HTML-escaped). */
function paragraph(line: string): string {
	return `<p style="margin: 0 0 12px; font-size: 13.5px; line-height: 1.6; color: ${TEXT_PRIMARY};">${escapeHtml(line)}</p>`;
}

/** A pre-escaped body fragment (already HTML-safe) in the shared paragraph style. */
function paragraphRaw(inner: string): string {
	return `<p style="margin: 0 0 12px; font-size: 13.5px; line-height: 1.6; color: ${TEXT_PRIMARY};">${inner}</p>`;
}

/**
 * Wrap already-rendered body fragments in the shared design-system chrome — the
 * page background, the account-headed card, and the Rivus footer — so every agent
 * email looks like one thread.
 */
function emailShell(accountName: string, agentName: string, body: string[]): string {
	return [
		'<!doctype html>',
		'<html lang="en">',
		`<body style="margin: 0; padding: 24px 12px; background: ${PAGE_BG}; font-family: ${FONT_STACK};">`,
		`<div style="max-width: 560px; margin: 0 auto; background: ${CARD_BG}; border: 1px solid ${HAIRLINE}; border-radius: 14px; padding: 24px;">`,
		`<p style="margin: 0 0 16px; font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: ${TEXT_SUB};">${escapeHtml(accountName)}</p>`,
		...body,
		'</div>',
		`<p style="max-width: 560px; margin: 12px auto 0; font-size: 11.5px; font-weight: 500; color: ${TEXT_SUB}; text-align: center;">${escapeHtml(FOOTER_NOTE(accountName, agentName))}</p>`,
		'</body>',
		'</html>',
	].join('\n');
}

/** HTML for the numbered options list — each label escaped, the leading number dropped. */
function optionsHtml(items: Array<{ label: string }>): string {
	const list = items
		.map(
			(item) =>
				`<li style="margin: 0 0 8px; font-size: 13.5px; line-height: 1.6; color: ${TEXT_PRIMARY}; font-weight: 600;">${escapeHtml(item.label)}</li>`,
		)
		.join('\n');
	return `<ol style="margin: 0 0 12px; padding-left: 20px;">${list}</ol>`;
}

/** HTML for a call-to-action: the one gradient button plus a plain-link fallback. */
function actionHtml(label: string, url: string): string[] {
	return [
		`<p style="margin: 16px 0;"><a href="${escapeHtml(url)}" ` +
			`style="display: inline-block; padding: 12px 22px; background: ${GRADIENT}; ` +
			`color: #ffffff; border-radius: 11px; text-decoration: none; font-weight: 600; ` +
			`font-size: 13.5px;">${escapeHtml(label)}</a></p>`,
		`<p style="margin: 0 0 12px; font-size: 11.5px; color: ${TEXT_SUB};">Or paste this link into your browser:<br>` +
			`<a href="${escapeHtml(url)}" style="color: ${TEXT_SUB};">${escapeHtml(url)}</a></p>`,
	];
}

/** Render a free-text reply (human or approved draft) into the shared card. */
function renderPlain(
	accountName: string,
	agentName: string,
	inboundSubject: string,
	body: string,
): RenderedEmail {
	// A blank line separates paragraphs; single breaks within one become <br>.
	// Newlines match `\r?\n` (like the inbound reply parser) so CRLF bodies split
	// the same as LF ones; the separator tolerates spaces/tabs on a blank line.
	const paragraphs = body
		.split(/\r?\n(?:[ \t]*\r?\n)+/)
		.map((block) =>
			block
				.split(/\r?\n/)
				.map((line) => escapeHtml(line))
				.join('<br>'),
		)
		.filter((block) => block.trim() !== '')
		.map((block) => paragraphRaw(block));
	return {
		subject: replySubject(inboundSubject, accountName),
		html: emailShell(accountName, agentName, paragraphs),
		text: body,
	};
}

/** Render a composed agent response into subject + design-system HTML + text. */
export function renderEmailResponse(
	response: AgentResponse,
	input: { accountName: string; agentName: string; inboundSubject: string },
): RenderedEmail {
	// A free-text response carries no agent chrome (greeting) and uses the
	// paragraph-splitting body form; agent decisions get the composed card.
	const plain = response.blocks.find((block) => block.kind === 'freeText');
	if (plain) {
		return renderPlain(input.accountName, input.agentName, input.inboundSubject, plain.text);
	}

	const body: string[] = [];
	for (const block of response.blocks) {
		switch (block.kind) {
			case 'greeting':
			case 'paragraph':
			case 'notice':
			case 'freeText':
				// A multi-line block becomes one paragraph per line (matching how the
				// prior templates mapped each lead/trail line to its own <p>).
				for (const line of block.text.split('\n')) {
					body.push(paragraph(line));
				}
				break;
			case 'options':
				body.push(optionsHtml(block.items));
				break;
			case 'action':
				body.push(...actionHtml(block.label, block.url));
				break;
		}
	}
	return {
		subject: replySubject(input.inboundSubject, input.accountName),
		html: emailShell(input.accountName, input.agentName, body),
		text: renderResponseText(response),
	};
}

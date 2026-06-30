import type { Role } from '@rivus/core';

/** An invitation email, ready to be addressed and rendered. */
export interface InviteEmail {
	/** Recipient address (the invitee). */
	to: string;
	/** The invitee's display name. */
	inviteeName: string;
	/** Display name of the member who sent the invite. */
	inviterName: string;
	/** Name of the account the invitee is being asked to join. */
	accountName: string;
	/** Role the invitee will hold once they accept. */
	role: Role;
	/** Absolute URL the invitee opens to accept (carries the invite token). */
	acceptUrl: string;
}

/** A one-time sign-in code emailed for passwordless signup or login. */
export interface VerificationEmail {
	/** Recipient address. */
	to: string;
	/** The 6-digit code (plaintext — this email is the only place it appears). */
	code: string;
	/**
	 * What the code does: finish a new signup, sign in an existing user, or confirm
	 * a change to the recipient's account email.
	 */
	purpose: 'login' | 'signup' | 'email_change';
}

/** A fully rendered email body — what a transport actually sends. */
export interface RenderedEmail {
	subject: string;
	html: string;
	text: string;
}

/** Delivers transactional email. Implementations reject on delivery failure. */
export interface Mailer {
	sendInviteEmail(email: InviteEmail): Promise<void>;
	sendVerificationCode(email: VerificationEmail): Promise<void>;
}

/** Human-readable labels for each role. */
const ROLE_LABELS: Record<Role, string> = {
	owner: 'Owner',
	manager: 'Manager',
	member: 'Member',
};

/** Escape the five characters that are unsafe to interpolate into HTML. */
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Build the absolute accept-invitation URL the email links to. `appUrl` is the
 * app's base URL; the opaque token is carried as a query parameter.
 */
export function buildInviteAcceptUrl(appUrl: string, token: string): string {
	const base = appUrl.replace(/\/+$/, '');
	return `${base}/accept-invite?token=${encodeURIComponent(token)}`;
}

/** Render an invitation into subject + HTML + plain-text bodies. */
export function renderInviteEmail(email: InviteEmail): RenderedEmail {
	const roleLabel = ROLE_LABELS[email.role];
	const subject = `You're invited to join ${email.accountName} on Rivus`;

	const text = [
		`Hi ${email.inviteeName},`,
		'',
		`${email.inviterName} has invited you to join ${email.accountName} on Rivus as a ${roleLabel}.`,
		'',
		`Accept your invitation: ${email.acceptUrl}`,
		'',
		"If you weren't expecting this invitation, you can safely ignore this email.",
	].join('\n');

	// User-controlled fields (names) are escaped; the URL and role label are not
	// attacker-controlled, but escaping them too keeps the template uniformly safe.
	const html = [
		'<!doctype html>',
		'<html lang="en">',
		'<body style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #111;">',
		`<p>Hi ${escapeHtml(email.inviteeName)},</p>`,
		`<p><strong>${escapeHtml(email.inviterName)}</strong> has invited you to join ` +
			`<strong>${escapeHtml(email.accountName)}</strong> on Rivus as a ${escapeHtml(roleLabel)}.</p>`,
		`<p><a href="${escapeHtml(email.acceptUrl)}" ` +
			'style="display: inline-block; padding: 10px 18px; background: #111; color: #fff; ' +
			'border-radius: 6px; text-decoration: none;">Accept invitation</a></p>',
		`<p style="color: #555; font-size: 13px;">Or paste this link into your browser:<br>` +
			`<a href="${escapeHtml(email.acceptUrl)}">${escapeHtml(email.acceptUrl)}</a></p>`,
		`<p style="color: #888; font-size: 12px;">If you weren't expecting this invitation, ` +
			'you can safely ignore this email.</p>',
		'</body>',
		'</html>',
	].join('\n');

	return { subject, html, text };
}

/** Render a one-time sign-in code into subject + HTML + plain-text bodies. */
export function renderVerificationEmail(email: VerificationEmail): RenderedEmail {
	const lead =
		email.purpose === 'signup'
			? 'Use this code to finish creating your Rivus account:'
			: email.purpose === 'email_change'
				? 'Use this code to confirm your new Rivus email address:'
				: 'Use this code to sign in to Rivus:';
	const subject = `Your Rivus verification code is ${email.code}`;

	const text = [
		lead,
		'',
		email.code,
		'',
		'This code expires in 10 minutes. If you did not request it, you can ignore this email.',
	].join('\n');

	// The code is generated server-side (digits only), so it needs no escaping;
	// there are no user-controlled values in this template.
	const html = [
		'<!doctype html>',
		'<html lang="en">',
		'<body style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #111;">',
		`<p>${lead}</p>`,
		`<p style="font-size: 32px; font-weight: 700; letter-spacing: 6px; margin: 16px 0;">${email.code}</p>`,
		'<p style="color: #888; font-size: 12px;">This code expires in 10 minutes. ' +
			'If you did not request it, you can ignore this email.</p>',
		'</body>',
		'</html>',
	].join('\n');

	return { subject, html, text };
}

/**
 * A mailer that delivers nothing — used when `RESEND_API_KEY` is unset so the API
 * still runs in development and tests without attempting real delivery.
 */
export class NoopMailer implements Mailer {
	async sendInviteEmail(_email: InviteEmail): Promise<void> {
		// Intentionally does nothing.
	}

	async sendVerificationCode(_email: VerificationEmail): Promise<void> {
		// Intentionally does nothing.
	}
}

import type { Config } from '../config';
import {
	type AgentEmail,
	type DemoLeadEmail,
	type InviteEmail,
	type Mailer,
	NoopMailer,
	renderDemoLeadEmail,
	renderInviteEmail,
	renderVerificationEmail,
	type VerificationEmail,
} from './email';

/** The subset of the Fetch API the mailer needs (so tests can inject a fake). */
export type FetchLike = (
	input: string,
	init: {
		method: string;
		headers: Record<string, string>;
		/** Absent for bodyless requests (GET) — `fetch` rejects a GET with a body. */
		body?: string;
		/** Optional deadline (e.g. `AbortSignal.timeout(…)`); the global fetch honors it. */
		signal?: AbortSignal;
	},
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface ResendMailerOptions {
	apiKey: string;
	/** The `from` address (`Name <address>` or a bare address). */
	from: string;
	/** Injectable fetch; defaults to the global. */
	fetchImpl?: FetchLike;
	/** Override the Resend endpoint (tests). */
	endpoint?: string;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Sends transactional email through Resend's HTTP API. We call the documented
 * REST endpoint with `fetch` rather than pulling in the SDK: it keeps the
 * dependency surface (and the supply-chain gate) small and makes the transport
 * trivially testable by injecting a fake `fetch`.
 */
export class ResendMailer implements Mailer {
	private readonly apiKey: string;
	private readonly from: string;
	private readonly fetchImpl: FetchLike;
	private readonly endpoint: string;

	constructor(options: ResendMailerOptions) {
		this.apiKey = options.apiKey;
		this.from = options.from;
		this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
		this.endpoint = options.endpoint ?? RESEND_ENDPOINT;
	}

	async sendInviteEmail(email: InviteEmail): Promise<void> {
		const { subject, html, text } = renderInviteEmail(email);
		await this.send({ to: email.to, subject, html, text });
	}

	async sendVerificationCode(email: VerificationEmail): Promise<void> {
		const { subject, html, text } = renderVerificationEmail(email);
		await this.send({ to: email.to, subject, html, text });
	}

	async sendDemoLeadEmail(email: DemoLeadEmail): Promise<void> {
		const { subject, html, text } = renderDemoLeadEmail(email);
		await this.send({ to: email.to, subject, html, text });
	}

	async sendAgentEmail(email: AgentEmail): Promise<void> {
		// Threading headers keep the reply in the customer's existing thread;
		// mail clients fall back to subject-matching when they're absent.
		const headers: Record<string, string> = {};
		if (email.inReplyTo) {
			headers['In-Reply-To'] = email.inReplyTo;
		}
		if (email.references.length > 0) {
			headers.References = email.references.join(' ');
		}
		await this.send({
			to: email.to,
			subject: email.subject,
			html: email.html,
			text: email.text,
			// The agent writes as the account's own address, not the global sender.
			from: email.from,
			...(Object.keys(headers).length > 0 ? { headers } : {}),
		});
	}

	private async send(message: {
		to: string;
		subject: string;
		html: string;
		text: string;
		from?: string;
		headers?: Record<string, string>;
	}): Promise<void> {
		const response = await this.fetchImpl(this.endpoint, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${this.apiKey}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({ from: this.from, ...message }),
		});

		if (!response.ok) {
			const detail = await response.text().catch(() => '');
			throw new Error(
				`Resend rejected the email (status ${response.status})${detail ? `: ${detail}` : ''}`,
			);
		}
	}
}

/**
 * Pick a mailer for the given config: a real Resend transport when an API key is
 * present, otherwise a no-op so the API still boots in development and tests.
 */
export function createMailer(
	config: Pick<Config, 'RESEND_API_KEY' | 'EMAIL_FROM'>,
	fetchImpl?: FetchLike,
): Mailer {
	if (!config.RESEND_API_KEY) {
		return new NoopMailer();
	}
	return new ResendMailer({
		apiKey: config.RESEND_API_KEY,
		from: config.EMAIL_FROM,
		fetchImpl,
	});
}

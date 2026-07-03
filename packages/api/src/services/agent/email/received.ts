import { z } from 'zod';
import type { FetchLike } from '../../resend-mailer';

/**
 * Fetching an inbound email's content. Resend's `email.received` webhook
 * carries metadata only, so the body, headers, and true `Message-ID` come from
 * a follow-up `GET /emails/receiving/{id}`. Behind an interface so tests (and
 * the no-key development setup) inject a fake instead of the network.
 */

/** The parts of a received email the scheduling agent needs. */
export interface ReceivedEmailContent {
	text: string;
	html: string;
	/** Raw header map (lower-cased keys are not guaranteed by the API). */
	headers: Record<string, string>;
	/** RFC 5322 Message-ID, e.g. `<abc@mail.example.com>`; '' when absent. */
	messageId: string;
}

/** Reads a received email's content by the id the webhook delivered. */
export interface ReceivedEmailReader {
	/** The email's content, or null when it can't be retrieved. */
	get(emailId: string): Promise<ReceivedEmailContent | null>;
}

const receivedEmailSchema = z.object({
	text: z.string().nullish(),
	html: z.string().nullish(),
	headers: z.record(z.string(), z.string()).nullish(),
	message_id: z.string().nullish(),
});

const RESEND_RECEIVING_ENDPOINT = 'https://api.resend.com/emails/receiving';

export interface ResendReceivedEmailReaderOptions {
	apiKey: string;
	/** Injectable fetch; defaults to the global. */
	fetchImpl?: FetchLike;
	/** Override the Resend endpoint (tests). */
	endpoint?: string;
}

/**
 * Reads received emails from Resend's REST API. Like the mailer, this calls
 * the documented endpoint with `fetch` rather than pulling in the SDK — a
 * smaller dependency surface and a trivially fakeable transport.
 */
export class ResendReceivedEmailReader implements ReceivedEmailReader {
	private readonly apiKey: string;
	private readonly fetchImpl: FetchLike;
	private readonly endpoint: string;

	constructor(options: ResendReceivedEmailReaderOptions) {
		this.apiKey = options.apiKey;
		this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
		this.endpoint = options.endpoint ?? RESEND_RECEIVING_ENDPOINT;
	}

	async get(emailId: string): Promise<ReceivedEmailContent | null> {
		const response = await this.fetchImpl(`${this.endpoint}/${encodeURIComponent(emailId)}`, {
			method: 'GET',
			headers: { authorization: `Bearer ${this.apiKey}` },
		});
		if (!response.ok) {
			return null;
		}
		let body: unknown;
		try {
			body = JSON.parse(await response.text());
		} catch {
			return null;
		}
		const parsed = receivedEmailSchema.safeParse(body);
		if (!parsed.success) {
			return null;
		}
		return {
			text: parsed.data.text ?? '',
			html: parsed.data.html ?? '',
			headers: parsed.data.headers ?? {},
			messageId: parsed.data.message_id ?? '',
		};
	}
}

/**
 * The reader used when no `RESEND_API_KEY` is configured: nothing can be
 * fetched, so webhook payloads must carry their own `text`/`html` (which the
 * local-development `curl` flow does).
 */
export class NoopReceivedEmailReader implements ReceivedEmailReader {
	async get(_emailId: string): Promise<ReceivedEmailContent | null> {
		return null;
	}
}

/** Pick a reader for the config: real when a Resend key exists, else a no-op. */
export function createReceivedEmailReader(
	config: { RESEND_API_KEY?: string },
	fetchImpl?: FetchLike,
): ReceivedEmailReader {
	if (!config.RESEND_API_KEY) {
		return new NoopReceivedEmailReader();
	}
	return new ResendReceivedEmailReader({ apiKey: config.RESEND_API_KEY, fetchImpl });
}

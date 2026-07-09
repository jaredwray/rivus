import { createHmac, timingSafeEqual } from 'node:crypto';
import { type AccountChannelConfig, type AccountId, normalizePhone } from '@rivus/core';
import { z } from 'zod';
import type { Config } from '../config';
import {
	type ChannelProvisioner,
	NoopChannelProvisioner,
	type ProvisionedIdentifier,
} from './channel-provisioning';
import type { FetchLike } from './resend-mailer';
import { NoopSmsSender, type SmsMessage, type SmsSender } from './sms';
import { NoopWhatsappSender, type WhatsappMessage, type WhatsappSender } from './whatsapp';

/**
 * The Plivo adapter for the messaging seams — the only module that knows
 * Plivo's wire format. Plivo fronts the same Messages API for SMS, MMS, and
 * WhatsApp (`type` selects the channel), and one rented number carries every
 * channel. It was the original primary provider; it is retained during the
 * migration to Twilio (`./twilio`) so numbers Plivo still owns keep sending
 * and receiving — `./messaging-provider` routes each outbound message through
 * the number's owner. Like `ZernioWhatsappSender` (kept as an alternative
 * WhatsApp provider) and `ResendMailer`, it calls the documented REST
 * endpoints with `fetch`, so it adds no dependency and is trivially faked in
 * tests.
 *
 * Wire format sources: Plivo's Messages API and Numbers API references, and the
 * signature algorithm from Plivo's published node SDK (`validateSignature`).
 */

// Leaf resources under `${PLIVO_API_URL}/Account/{authId}`.
const MESSAGE_PATH = '/Message/';
const NUMBER_SEARCH_PATH = '/PhoneNumber/';

interface PlivoOptions {
	authId: string;
	authToken: string;
	apiUrl: string;
	fetchImpl?: FetchLike;
}

function basicAuth(authId: string, authToken: string): Record<string, string> {
	const credentials = Buffer.from(`${authId}:${authToken}`).toString('base64');
	return { authorization: `Basic ${credentials}`, 'content-type': 'application/json' };
}

function accountUrl(apiUrl: string, authId: string, leaf: string): string {
	return `${apiUrl.replace(/\/+$/, '')}/Account/${authId}${leaf}`;
}

/** A webhook URL as Plivo signs it: query string (and fragment) stripped. */
function stripQuery(url: string): string {
	const withoutFragment = url.split('#', 1)[0] ?? '';
	return withoutFragment.split('?', 1)[0] ?? '';
}

/**
 * Compute the `X-Plivo-Signature-V2` value for a webhook delivery — the base64
 * HMAC-SHA256 of the webhook URL (without its query string) concatenated with
 * the `X-Plivo-Signature-V2-Nonce`, keyed by the account's auth token. Matches
 * Plivo's SDK `validateSignature`. The counterpart of
 * {@link verifyPlivoSignature}, used by tests (and handy for local `curl`s).
 */
export function signPlivoUrl(options: { authToken: string; url: string; nonce: string }): string {
	return createHmac('sha256', options.authToken)
		.update(stripQuery(options.url) + options.nonce)
		.digest('base64');
}

/**
 * Verify a Plivo webhook delivery. Unlike zernio's scheme (which signs the raw
 * body), Plivo V2 signs only the **URL + nonce** — the URL exactly as Plivo
 * called it. `X-Plivo-Signature-V2` carries the signature computed with the
 * (sub)account's auth token and `X-Plivo-Signature-Ma-V2` the one computed with
 * the main account's; either may hold several comma-separated candidates during
 * a token rotation, so any single match passes.
 */
export function verifyPlivoSignature(options: {
	/** The account auth token (the signing key). */
	authToken: string;
	/** The URL Plivo called, byte-for-byte as configured (query is ignored). */
	url: string;
	/** The `X-Plivo-Signature-V2-Nonce` header value. */
	nonce: string;
	/** The `X-Plivo-Signature-V2` header value. */
	signature: string;
	/** The `X-Plivo-Signature-Ma-V2` header value, when present. */
	maSignature?: string;
}): boolean {
	if (!options.authToken || options.nonce === '') {
		return false;
	}
	const candidates = [options.signature, options.maSignature ?? '']
		.flatMap((header) => header.split(','))
		.map((value) => value.trim())
		.filter((value) => value !== '');
	if (candidates.length === 0) {
		return false;
	}
	const expected = Buffer.from(
		signPlivoUrl({ authToken: options.authToken, url: options.url, nonce: options.nonce }),
		'utf8',
	);
	return candidates.some((candidate) => {
		const provided = Buffer.from(candidate, 'utf8');
		return provided.length === expected.length && timingSafeEqual(provided, expected);
	});
}

/**
 * The Messages-API transport both channel senders share: one endpoint, one auth
 * header, one payload shape — only the `type` field and the status-callback URL
 * (each channel's own webhook) differ per channel.
 */
class PlivoMessageTransport {
	private readonly endpoint: string;
	private readonly headers: Record<string, string>;
	private readonly statusCallbackUrl: string;
	private readonly fetchImpl: FetchLike;

	constructor(options: PlivoOptions & { statusCallbackUrl?: string }) {
		this.endpoint = accountUrl(options.apiUrl, options.authId, MESSAGE_PATH);
		this.headers = basicAuth(options.authId, options.authToken);
		this.statusCallbackUrl = options.statusCallbackUrl ?? '';
		this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
	}

	protected async post(
		message: { from: string; to: string; text: string },
		type: 'whatsapp' | 'sms',
		label: string,
	): Promise<void> {
		const body: Record<string, string> = {
			src: message.from,
			dst: message.to,
			type,
			text: message.text,
		};
		// Delivery reports come back to the channel's webhook so failures flag the inbox.
		if (this.statusCallbackUrl !== '') {
			body.url = this.statusCallbackUrl;
		}
		const response = await this.fetchImpl(this.endpoint, {
			method: 'POST',
			headers: this.headers,
			body: JSON.stringify(body),
		});
		if (!response.ok) {
			const detail = await response.text().catch(() => '');
			throw new Error(
				`Plivo rejected the ${label} message (status ${response.status})${detail ? `: ${detail}` : ''}`,
			);
		}
	}
}

export class PlivoWhatsappSender extends PlivoMessageTransport implements WhatsappSender {
	/**
	 * Send a free-form WhatsApp text. Meta only allows free-form messages inside
	 * the 24-hour customer-service window, which every agent send satisfies (the
	 * customer always messages first, and inbox reply-out answers an open
	 * conversation). TODO(plivo): add templated sends when Rivus initiates
	 * conversations (reminders, review requests) outside the window.
	 */
	async sendMessage(message: WhatsappMessage): Promise<void> {
		await this.post(message, 'whatsapp', 'WhatsApp');
	}
}

export class PlivoSmsSender extends PlivoMessageTransport implements SmsSender {
	/**
	 * Send an SMS. Long messages concatenate into segments on Plivo's side; the
	 * SMS channel's renderer caps length, so a text never exceeds the segment
	 * budget. Unlike WhatsApp there is no session window — but the agent still
	 * only ever replies, and US A2P traffic needs the number registered for
	 * 10DLC in the Plivo console before carriers accept it.
	 */
	async sendMessage(message: SmsMessage): Promise<void> {
		await this.post(message, 'sms', 'SMS');
	}
}

const searchResponseSchema = z.object({
	objects: z.array(z.object({ number: z.string() })).default([]),
});

const buyResponseSchema = z.object({
	numbers: z
		.array(z.object({ number: z.string().default(''), status: z.string().default('') }))
		.default([]),
});

/**
 * Rents an SMS+voice-capable number from Plivo's Numbers API when an owner
 * enables the channel. One rented number is the account's identity across
 * WhatsApp today and SMS/voice later — that single-number story is the point of
 * standardizing on Plivo.
 *
 * Renting alone does not make the number WhatsApp-ready: it must then be
 * registered to Rivus's WhatsApp Business Account via Meta's Embedded Signup in
 * the Plivo console (a one-time, human step per number today).
 * TODO(plivo): automate WABA registration if/when Plivo exposes its Tech
 * Provider onboarding over the API.
 */
export class PlivoProvisioner implements ChannelProvisioner {
	private readonly searchUrl: string;
	private readonly apiUrl: string;
	private readonly authId: string;
	private readonly headers: Record<string, string>;
	private readonly country: string;
	private readonly fetchImpl: FetchLike;

	constructor(options: PlivoOptions & { numberCountry: string }) {
		this.apiUrl = options.apiUrl;
		this.authId = options.authId;
		this.searchUrl = accountUrl(options.apiUrl, options.authId, NUMBER_SEARCH_PATH);
		this.headers = basicAuth(options.authId, options.authToken);
		this.country = options.numberCountry.toUpperCase();
		this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
	}

	async provision(input: {
		accountId: AccountId;
		accountName: string;
		existing: ProvisionedIdentifier;
	}): Promise<ProvisionedIdentifier> {
		// Idempotent: never re-provision an account that already holds a number.
		if (input.existing.address !== '') {
			return input.existing;
		}
		const number = await this.findAvailableNumber();
		await this.rent(number);
		// Plivo returns bare E.164 digits ("14154009186"); the account stores `+`-form.
		const address = normalizePhone(`+${number.replace(/^\+/, '')}`);
		if (address === '') {
			throw new Error(`Plivo offered a number that is not valid E.164: ${number}`);
		}
		// The ref is the address's own bare digits — the exact fingerprint
		// `plivoOwnsRef` checks — not the raw search result, so a `+`-formed or
		// formatted number from Plivo can never break ownership routing/sharing.
		return { address, providerRef: address.slice(1) };
	}

	/** Search for a rentable number that supports voice + SMS (one number, every channel). */
	private async findAvailableNumber(): Promise<string> {
		const query = new URLSearchParams({
			country_iso: this.country,
			services: 'voice,sms',
			limit: '5',
		});
		const response = await this.fetchImpl(`${this.searchUrl}?${query}`, {
			method: 'GET',
			headers: this.headers,
		});
		if (!response.ok) {
			const detail = await response.text().catch(() => '');
			throw new Error(
				`Plivo number search failed (status ${response.status})${detail ? `: ${detail}` : ''}`,
			);
		}
		const parsed = searchResponseSchema.safeParse(JSON.parse(await response.text()));
		const number = parsed.success ? parsed.data.objects[0]?.number : undefined;
		if (!number) {
			throw new Error(`Plivo has no ${this.country} numbers with voice+SMS available to rent.`);
		}
		return number;
	}

	private async rent(number: string): Promise<void> {
		const response = await this.fetchImpl(
			accountUrl(this.apiUrl, this.authId, `${NUMBER_SEARCH_PATH}${number}/`),
			{ method: 'POST', headers: this.headers, body: JSON.stringify({}) },
		);
		if (!response.ok) {
			const detail = await response.text().catch(() => '');
			throw new Error(
				`Plivo refused to rent ${number} (status ${response.status})${detail ? `: ${detail}` : ''}`,
			);
		}
		const parsed = buyResponseSchema.safeParse(JSON.parse(await response.text()));
		const status = (parsed.success ? (parsed.data.numbers[0]?.status ?? '') : '').toLowerCase();
		// Countries that require verification documents answer `pending`: the rental
		// HAS been placed and activates when compliance clears. Treat it as rented —
		// throwing here would drop the providerRef after money moved, and the next
		// enable attempt would buy a second number.
		if (status !== 'success' && status !== 'pending') {
			throw new Error(`Plivo did not confirm the rental of ${number} (status "${status}").`);
		}
	}
}

type PlivoCredentials = Pick<Config, 'PLIVO_AUTH_ID' | 'PLIVO_AUTH_TOKEN' | 'PLIVO_API_URL'>;

/** A WhatsApp sender for the config: real Plivo when credentials are present, else a no-op. */
export function createPlivoWhatsappSender(
	config: PlivoCredentials & Pick<Config, 'PLIVO_WEBHOOK_URL'>,
	fetchImpl?: FetchLike,
): WhatsappSender {
	if (!config.PLIVO_AUTH_ID || !config.PLIVO_AUTH_TOKEN) {
		return new NoopWhatsappSender();
	}
	return new PlivoWhatsappSender({
		authId: config.PLIVO_AUTH_ID,
		authToken: config.PLIVO_AUTH_TOKEN,
		apiUrl: config.PLIVO_API_URL,
		statusCallbackUrl: config.PLIVO_WEBHOOK_URL,
		fetchImpl,
	});
}

/** An SMS sender for the config: real Plivo when credentials are present, else a no-op. */
export function createPlivoSmsSender(
	config: PlivoCredentials & Pick<Config, 'PLIVO_SMS_WEBHOOK_URL'>,
	fetchImpl?: FetchLike,
): SmsSender {
	if (!config.PLIVO_AUTH_ID || !config.PLIVO_AUTH_TOKEN) {
		return new NoopSmsSender();
	}
	return new PlivoSmsSender({
		authId: config.PLIVO_AUTH_ID,
		authToken: config.PLIVO_AUTH_TOKEN,
		apiUrl: config.PLIVO_API_URL,
		statusCallbackUrl: config.PLIVO_SMS_WEBHOOK_URL,
		fetchImpl,
	});
}

/** A channel provisioner for the config: real Plivo when credentials are present, else a no-op. */
export function createPlivoProvisioner(
	config: PlivoCredentials & Pick<Config, 'PLIVO_NUMBER_COUNTRY'>,
	fetchImpl?: FetchLike,
): ChannelProvisioner {
	if (!config.PLIVO_AUTH_ID || !config.PLIVO_AUTH_TOKEN) {
		return new NoopChannelProvisioner();
	}
	return new PlivoProvisioner({
		authId: config.PLIVO_AUTH_ID,
		authToken: config.PLIVO_AUTH_TOKEN,
		apiUrl: config.PLIVO_API_URL,
		numberCountry: config.PLIVO_NUMBER_COUNTRY,
		fetchImpl,
	});
}

/**
 * Whether a stored providerRef names a Plivo-owned number: {@link
 * PlivoProvisioner} stores exactly the address's bare digits, which no other
 * provisioner writes (Twilio stores a `PN…` SID, zernio an opaque id, the
 * no-op `'noop'`).
 */
export function plivoOwnsRef(providerRef: string, address: string): boolean {
	return providerRef !== '' && providerRef === address.replace(/^\+/, '');
}

/**
 * The identifier a channel config holds **iff Plivo owns its number**. The
 * channel-enable route uses this to give a channel its sibling's Plivo number
 * instead of renting a second one — the one-number-across-channels story —
 * while numbers Plivo does not own are never shared onto a channel Plivo would
 * have to send from; `messaging-provider` uses the same fingerprint to route
 * each send through the number's owner.
 */
export function plivoOwnedIdentifier(config: AccountChannelConfig): ProvisionedIdentifier | null {
	if (config.address === '' || !plivoOwnsRef(config.providerRef, config.address)) {
		return null;
	}
	return { address: config.address, providerRef: config.providerRef };
}

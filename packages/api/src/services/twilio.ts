import { createHmac, timingSafeEqual } from 'node:crypto';
import { type AccountChannelConfig, normalizePhone } from '@rivus/core';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config';
import {
	type ChannelProvisioner,
	NoopChannelProvisioner,
	NoopNumberReleaser,
	type NumberReleaser,
	type ProvisionedIdentifier,
	type ProvisionInput,
	type ReleaseOutcome,
} from './channel-provisioning';
import type { FetchLike } from './resend-mailer';
import { NoopSmsSender, type SmsMessage, type SmsSender } from './sms';
import { NoopWhatsappSender, type WhatsappMessage, type WhatsappSender } from './whatsapp';

/**
 * The Twilio adapter for the messaging seams — the only module that knows
 * Twilio's wire format. Twilio is the primary provider: one Messages API
 * fronts SMS and WhatsApp (the `whatsapp:` address prefix selects the
 * channel), numbers rent with their webhooks attached in the same purchase
 * call, and voice rides the same number via TwiML. The Plivo adapter
 * (`./plivo`) stays wired for numbers it still owns during the migration —
 * outbound sends route per number owner in `./messaging-provider`.
 *
 * Wire format sources: Twilio's Message resource, IncomingPhoneNumbers, and
 * request-validation docs (the signature test vector in `test/twilio.test.ts`
 * is Twilio's own published example).
 */

const API_VERSION = '2010-04-01';

interface TwilioOptions {
	accountSid: string;
	authToken: string;
	apiUrl: string;
	fetchImpl?: FetchLike;
}

function basicAuth(accountSid: string, authToken: string): Record<string, string> {
	const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
	return {
		authorization: `Basic ${credentials}`,
		'content-type': 'application/x-www-form-urlencoded',
	};
}

function accountUrl(apiUrl: string, accountSid: string, leaf: string): string {
	return `${apiUrl.replace(/\/+$/, '')}/${API_VERSION}/Accounts/${accountSid}${leaf}`;
}

/**
 * Parse a JSON response body, returning `undefined` (rather than throwing) when
 * it isn't valid JSON — so a proxy error page or an empty body surfaces as a
 * clean "unexpected response" through the schema check, with the raw body
 * already logged, instead of an opaque `SyntaxError`.
 */
function safeJson(body: string): unknown {
	try {
		return JSON.parse(body);
	} catch {
		return undefined;
	}
}

/** The parsed form parameters of a webhook request (a repeated key is an array). */
export type TwilioWebhookParams = Record<string, string | string[]>;

/**
 * Compute the `X-Twilio-Signature` for a webhook request — Twilio's published
 * algorithm: take the full URL exactly as requested (query string included,
 * still URL-encoded), append each POST parameter's name and value (form-decoded,
 * no delimiters) sorted by name in code-point order, HMAC-SHA1 the result keyed
 * by the auth token, and base64-encode. A repeated parameter contributes each
 * *distinct* value once, sorted, name re-attached per value — the behavior of
 * Twilio's own SDK validators. The counterpart of {@link verifyTwilioSignature},
 * used by tests (and handy for local `curl`s).
 */
export function signTwilioRequest(options: {
	authToken: string;
	url: string;
	params: TwilioWebhookParams;
}): string {
	const data =
		options.url +
		Object.keys(options.params)
			.sort()
			.map((key) => {
				const value = options.params[key];
				if (Array.isArray(value)) {
					return Array.from(new Set(value))
						.sort()
						.map((entry) => key + entry)
						.join('');
				}
				return key + value;
			})
			.join('');
	return createHmac('sha1', options.authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

/**
 * The URL variants a Twilio signature may have been computed over: Twilio's
 * own back end is inconsistent about explicit default ports (their SDKs accept
 * a match with or without one), so verification tries the URL as reconstructed
 * plus its with-/without-default-port sibling.
 */
function urlCandidates(url: string): string[] {
	const candidates = [url];
	const match = url.match(/^(https?):\/\/([^/]+)(.*)$/);
	if (!match) {
		return candidates;
	}
	const [, scheme, host, rest] = match;
	const defaultPort = scheme === 'https' ? ':443' : ':80';
	if (host?.endsWith(defaultPort)) {
		candidates.push(`${scheme}://${host.slice(0, -defaultPort.length)}${rest}`);
	} else if (host && !host.includes(':')) {
		candidates.push(`${scheme}://${host}${defaultPort}${rest}`);
	}
	return candidates;
}

/**
 * Verify a Twilio webhook delivery. Unlike Plivo's URL+nonce scheme, Twilio
 * signs the URL **plus every form parameter**, so callers pass the parsed
 * form body — all of it, since Twilio adds parameters without notice.
 */
export function verifyTwilioSignature(options: {
	/** The account auth token (the signing key). */
	authToken: string;
	/** The URL Twilio called, as configured/reconstructed (query kept encoded). */
	url: string;
	/** Every form parameter of the request, form-decoded. */
	params: TwilioWebhookParams;
	/** The `X-Twilio-Signature` header value. */
	signature: string;
}): boolean {
	if (!options.authToken || options.signature === '') {
		return false;
	}
	const provided = Buffer.from(options.signature.trim(), 'utf8');
	return urlCandidates(options.url).some((url) => {
		const expected = Buffer.from(
			signTwilioRequest({ authToken: options.authToken, url, params: options.params }),
			'utf8',
		);
		return provided.length === expected.length && timingSafeEqual(provided, expected);
	});
}

/**
 * The Messages-API transport both channel senders share: one endpoint, one
 * auth header, one form-encoded payload — only the `whatsapp:` address prefix
 * and the status-callback URL (each channel's own webhook) differ per channel.
 */
class TwilioMessageTransport {
	private readonly endpoint: string;
	private readonly headers: Record<string, string>;
	private readonly statusCallbackUrl: string;
	private readonly fetchImpl: FetchLike;

	constructor(options: TwilioOptions & { statusCallbackUrl?: string }) {
		this.endpoint = accountUrl(options.apiUrl, options.accountSid, '/Messages.json');
		this.headers = basicAuth(options.accountSid, options.authToken);
		this.statusCallbackUrl = options.statusCallbackUrl ?? '';
		this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
	}

	protected async post(
		message: { from: string; to: string; text: string },
		addressPrefix: '' | 'whatsapp:',
		label: string,
	): Promise<void> {
		const form = new URLSearchParams({
			From: `${addressPrefix}${message.from}`,
			To: `${addressPrefix}${message.to}`,
			Body: message.text,
		});
		// Delivery reports come back to the channel's webhook so failures flag the inbox.
		if (this.statusCallbackUrl !== '') {
			form.set('StatusCallback', this.statusCallbackUrl);
		}
		const response = await this.fetchImpl(this.endpoint, {
			method: 'POST',
			headers: this.headers,
			body: form.toString(),
		});
		if (!response.ok) {
			const detail = await response.text().catch(() => '');
			throw new Error(
				`Twilio rejected the ${label} message (status ${response.status})${detail ? `: ${detail}` : ''}`,
			);
		}
	}
}

export class TwilioWhatsappSender extends TwilioMessageTransport implements WhatsappSender {
	/**
	 * Send a free-form WhatsApp text. Meta only allows free-form messages inside
	 * the 24-hour customer-service window, which every agent send satisfies (the
	 * customer always messages first). TODO(twilio): templated sends via the
	 * Content API when Rivus initiates conversations outside the window.
	 */
	async sendMessage(message: WhatsappMessage): Promise<void> {
		await this.post(message, 'whatsapp:', 'WhatsApp');
	}
}

export class TwilioSmsSender extends TwilioMessageTransport implements SmsSender {
	/** Send an SMS. The SMS renderer caps bodies at Twilio's 1600-char limit already. */
	async sendMessage(message: SmsMessage): Promise<void> {
		await this.post(message, '', 'SMS');
	}
}

const searchResponseSchema = z.object({
	available_phone_numbers: z.array(z.object({ phone_number: z.string() })).default([]),
});

const purchaseResponseSchema = z.object({
	sid: z.string().default(''),
	phone_number: z.string().default(''),
});

/**
 * Rents an SMS+voice-capable number from Twilio when an owner enables a
 * channel — the same one-number-across-channels model as the Plivo
 * provisioner, with one improvement Twilio makes possible: the purchase call
 * attaches the number's inbound webhooks (SmsUrl, VoiceUrl) in the same
 * request, so no console step is needed for SMS or voice to start flowing.
 *
 * WhatsApp still needs the number registered as a WhatsApp sender afterwards
 * (Twilio's Senders API can do it programmatically, but it requires a WABA
 * link and an OTP round-trip). TODO(twilio): automate sender registration via
 * POST messaging.twilio.com/v2/Channels/Senders once WABA onboarding is set up.
 */
export class TwilioProvisioner implements ChannelProvisioner {
	private readonly apiUrl: string;
	private readonly accountSid: string;
	private readonly headers: Record<string, string>;
	private readonly country: string;
	private readonly webhooks: { smsUrl: string; voiceUrl: string };
	private readonly fetchImpl: FetchLike;

	constructor(
		options: TwilioOptions & {
			numberCountry: string;
			/** Public webhook URLs to attach to the number at purchase ('' skips). */
			smsUrl?: string;
			voiceUrl?: string;
		},
	) {
		this.apiUrl = options.apiUrl;
		this.accountSid = options.accountSid;
		this.headers = basicAuth(options.accountSid, options.authToken);
		this.country = options.numberCountry.toUpperCase();
		this.webhooks = { smsUrl: options.smsUrl ?? '', voiceUrl: options.voiceUrl ?? '' };
		this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
	}

	async provision(input: ProvisionInput): Promise<ProvisionedIdentifier> {
		// Idempotent: never re-provision an account that already holds a number.
		if (input.existing.address !== '') {
			return input.existing;
		}
		// A dedicated child logger so every line of a single provisioning attempt
		// is correlatable, and a failed enable can be diagnosed from the logs (the
		// route only surfaces a generic 502).
		const logger = input.logger?.child({
			scope: 'twilio-provision',
			accountId: input.accountId,
			country: this.country,
			smsWebhook: this.webhooks.smsUrl !== '',
			voiceWebhook: this.webhooks.voiceUrl !== '',
		});
		logger?.info('renting a Twilio number');
		const number = await this.findAvailableNumber(logger);
		const purchased = await this.purchase(number, logger);
		// Twilio returns E.164 with the leading `+` already.
		const address = normalizePhone(purchased.phoneNumber);
		if (address === '') {
			logger?.error({ offered: purchased.phoneNumber }, 'Twilio offered a non-E.164 number');
			throw new Error(`Twilio offered a number that is not valid E.164: ${purchased.phoneNumber}`);
		}
		logger?.info({ address, providerRef: purchased.sid }, 'rented a Twilio number');
		return { address, providerRef: purchased.sid };
	}

	/** Search for a rentable local number that supports voice + SMS. */
	private async findAvailableNumber(logger?: FastifyBaseLogger): Promise<string> {
		const query = new URLSearchParams({
			SmsEnabled: 'true',
			VoiceEnabled: 'true',
			PageSize: '5',
		});
		const url = `${accountUrl(this.apiUrl, this.accountSid, `/AvailablePhoneNumbers/${this.country}/Local.json`)}?${query}`;
		logger?.info({ url }, 'searching for an available number');
		const response = await this.fetchImpl(url, { method: 'GET', headers: this.headers });
		const body = await response.text().catch(() => '');
		if (!response.ok) {
			// The response body carries Twilio's error code + message (e.g. 20003
			// auth failure, or a geo-permission / trial-account rejection).
			logger?.error({ status: response.status, body }, 'Twilio number search failed');
			throw new Error(
				`Twilio number search failed (status ${response.status})${body ? `: ${body}` : ''}`,
			);
		}
		const parsed = searchResponseSchema.safeParse(safeJson(body));
		const number = parsed.success
			? parsed.data.available_phone_numbers[0]?.phone_number
			: undefined;
		if (!number) {
			logger?.error(
				{
					status: response.status,
					matches: parsed.success ? parsed.data.available_phone_numbers.length : 0,
				},
				'Twilio search returned no rentable voice+SMS numbers',
			);
			throw new Error(`Twilio has no ${this.country} numbers with voice+SMS available to rent.`);
		}
		logger?.info({ number }, 'found an available number');
		return number;
	}

	private async purchase(
		number: string,
		logger?: FastifyBaseLogger,
	): Promise<{ sid: string; phoneNumber: string }> {
		const form = new URLSearchParams({ PhoneNumber: number });
		// Attach the inbound webhooks in the same call — the number is live for
		// SMS and voice the moment it is rented, no console step.
		if (this.webhooks.smsUrl !== '') {
			form.set('SmsUrl', this.webhooks.smsUrl);
			form.set('SmsMethod', 'POST');
		}
		if (this.webhooks.voiceUrl !== '') {
			form.set('VoiceUrl', this.webhooks.voiceUrl);
			form.set('VoiceMethod', 'POST');
		}
		logger?.info({ number }, 'purchasing the number');
		const response = await this.fetchImpl(
			accountUrl(this.apiUrl, this.accountSid, '/IncomingPhoneNumbers.json'),
			{ method: 'POST', headers: this.headers, body: form.toString() },
		);
		const body = await response.text().catch(() => '');
		if (!response.ok) {
			// Common causes visible here: 21404 (number no longer available), a
			// trial account that can't purchase, or an unverified geo permission.
			logger?.error({ status: response.status, number, body }, 'Twilio refused to rent the number');
			throw new Error(
				`Twilio refused to rent ${number} (status ${response.status})${body ? `: ${body}` : ''}`,
			);
		}
		const parsed = purchaseResponseSchema.safeParse(safeJson(body));
		if (!parsed.success || parsed.data.sid === '') {
			logger?.error({ status: response.status, number, body }, 'Twilio did not confirm the rental');
			throw new Error(`Twilio did not confirm the rental of ${number}.`);
		}
		return { sid: parsed.data.sid, phoneNumber: parsed.data.phone_number || number };
	}
}

/**
 * Releases a rented number back to Twilio (`DELETE IncomingPhoneNumbers/{PN…}`,
 * which answers 204 and stops the rental's billing). Backs the dev-only
 * "release & reset" admin flow; a ref Twilio no longer knows (already released
 * in the console) reports `not_found` so cleanup can proceed.
 */
export class TwilioNumberReleaser implements NumberReleaser {
	private readonly apiUrl: string;
	private readonly accountSid: string;
	private readonly headers: Record<string, string>;
	private readonly fetchImpl: FetchLike;

	constructor(options: TwilioOptions) {
		this.apiUrl = options.apiUrl;
		this.accountSid = options.accountSid;
		this.headers = basicAuth(options.accountSid, options.authToken);
		this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
	}

	async release(providerRef: string, logger?: FastifyBaseLogger): Promise<ReleaseOutcome> {
		logger?.info({ providerRef }, 'releasing a Twilio number');
		const response = await this.fetchImpl(
			accountUrl(this.apiUrl, this.accountSid, `/IncomingPhoneNumbers/${providerRef}.json`),
			{ method: 'DELETE', headers: this.headers },
		);
		if (response.status === 404) {
			logger?.info({ providerRef }, 'number already released');
			return 'not_found';
		}
		if (!response.ok) {
			const body = await response.text().catch(() => '');
			logger?.error({ status: response.status, providerRef, body }, 'Twilio refused the release');
			throw new Error(
				`Twilio refused to release ${providerRef} (status ${response.status})${body ? `: ${body}` : ''}`,
			);
		}
		return 'released';
	}
}

/** A number releaser for the config: real Twilio when credentials are present, else a no-op. */
export function createTwilioNumberReleaser(
	config: TwilioCredentials,
	fetchImpl?: FetchLike,
): NumberReleaser {
	if (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN) {
		return new NoopNumberReleaser();
	}
	return new TwilioNumberReleaser({
		accountSid: config.TWILIO_ACCOUNT_SID,
		authToken: config.TWILIO_AUTH_TOKEN,
		apiUrl: config.TWILIO_API_URL,
		fetchImpl,
	});
}

/**
 * Twilio's shared WhatsApp **sandbox** number — the same for every Twilio
 * account (testers opt in with a per-account join code). A development account
 * can hold it as its WhatsApp address so sandbox traffic resolves to it
 * (`POST /v1/admin/sandbox/whatsapp`).
 */
export const TWILIO_WHATSAPP_SANDBOX_NUMBER = '+14155238886';

/**
 * The providerRef stored while an account borrows the sandbox number.
 * Deliberately NOT an ownership fingerprint: outbound sends fall through to the
 * primary chain (Twilio, when configured — exactly how sandbox sends work), and
 * the channel-enable sharing logic never adopts the shared sandbox number onto
 * SMS/voice the way it would a genuinely owned `PN…` number.
 */
export const TWILIO_SANDBOX_PROVIDER_REF = 'twilio-sandbox';

/** Twilio phone-number SIDs: `PN` + 32 hex characters. */
const TWILIO_NUMBER_SID = /^PN[0-9a-fA-F]{32}$/;

/** Whether a stored providerRef names a Twilio-owned number. */
export function twilioOwnsRef(providerRef: string): boolean {
	return TWILIO_NUMBER_SID.test(providerRef);
}

/**
 * The identifier a channel config holds **iff Twilio owns its number** — the
 * fingerprint is the `PN…` phone-number SID {@link TwilioProvisioner} stores,
 * which no other provisioner writes (Plivo stores the bare digits, zernio its
 * own opaque id, the no-op `'noop'`). The channel-enable route uses this to
 * share one number across channels; `messaging-provider` uses it to route each
 * send through the number's owner.
 */
export function twilioOwnedIdentifier(config: AccountChannelConfig): ProvisionedIdentifier | null {
	if (config.address === '' || !twilioOwnsRef(config.providerRef)) {
		return null;
	}
	return { address: config.address, providerRef: config.providerRef };
}

type TwilioCredentials = Pick<
	Config,
	'TWILIO_ACCOUNT_SID' | 'TWILIO_AUTH_TOKEN' | 'TWILIO_API_URL'
>;

/** A WhatsApp sender for the config: real Twilio when credentials are present, else a no-op. */
export function createTwilioWhatsappSender(
	config: TwilioCredentials & Pick<Config, 'TWILIO_WHATSAPP_WEBHOOK_URL'>,
	fetchImpl?: FetchLike,
): WhatsappSender {
	if (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN) {
		return new NoopWhatsappSender();
	}
	return new TwilioWhatsappSender({
		accountSid: config.TWILIO_ACCOUNT_SID,
		authToken: config.TWILIO_AUTH_TOKEN,
		apiUrl: config.TWILIO_API_URL,
		statusCallbackUrl: config.TWILIO_WHATSAPP_WEBHOOK_URL,
		fetchImpl,
	});
}

/** An SMS sender for the config: real Twilio when credentials are present, else a no-op. */
export function createTwilioSmsSender(
	config: TwilioCredentials & Pick<Config, 'TWILIO_SMS_WEBHOOK_URL'>,
	fetchImpl?: FetchLike,
): SmsSender {
	if (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN) {
		return new NoopSmsSender();
	}
	return new TwilioSmsSender({
		accountSid: config.TWILIO_ACCOUNT_SID,
		authToken: config.TWILIO_AUTH_TOKEN,
		apiUrl: config.TWILIO_API_URL,
		statusCallbackUrl: config.TWILIO_SMS_WEBHOOK_URL,
		fetchImpl,
	});
}

/** A channel provisioner for the config: real Twilio when credentials are present, else a no-op. */
export function createTwilioProvisioner(
	config: TwilioCredentials &
		Pick<Config, 'TWILIO_NUMBER_COUNTRY' | 'TWILIO_SMS_WEBHOOK_URL' | 'TWILIO_VOICE_WEBHOOK_URL'>,
	fetchImpl?: FetchLike,
): ChannelProvisioner {
	if (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN) {
		return new NoopChannelProvisioner();
	}
	return new TwilioProvisioner({
		accountSid: config.TWILIO_ACCOUNT_SID,
		authToken: config.TWILIO_AUTH_TOKEN,
		apiUrl: config.TWILIO_API_URL,
		numberCountry: config.TWILIO_NUMBER_COUNTRY,
		smsUrl: config.TWILIO_SMS_WEBHOOK_URL,
		// The number's VoiceUrl is the answer endpoint of the voice webhook pair.
		voiceUrl: config.TWILIO_VOICE_WEBHOOK_URL,
		fetchImpl,
	});
}

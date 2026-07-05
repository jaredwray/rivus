import { type AccountId, normalizePhone } from '@rivus/core';
import { z } from 'zod';
import type { Config } from '../config';
import {
	type ChannelProvisioner,
	NoopChannelProvisioner,
	type ProvisionedIdentifier,
} from './channel-provisioning';
import type { FetchLike } from './resend-mailer';
import { NoopWhatsappSender, type WhatsappMessage, type WhatsappSender } from './whatsapp';

/**
 * The zernio adapter for the WhatsApp seams — the only module that knows zernio's
 * wire format. It calls the documented REST endpoints with `fetch` (the same
 * injectable-transport pattern as `ResendMailer`), so it adds no dependency and
 * is trivially faked in tests. Every zernio-specific assumption (endpoint paths,
 * request/response field names) is marked `TODO(zernio)` and lives here alone, so
 * finalizing against the real docs touches only this file.
 */

// TODO(zernio): confirm the send + provision endpoint paths against zernio's docs.
const SEND_PATH = '/v1/messages';
const NUMBERS_PATH = '/v1/numbers';

interface ZernioOptions {
	apiKey: string;
	apiUrl: string;
	fetchImpl?: FetchLike;
}

function bearer(apiKey: string): Record<string, string> {
	return { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };
}

export class ZernioWhatsappSender implements WhatsappSender {
	private readonly apiKey: string;
	private readonly endpoint: string;
	private readonly fetchImpl: FetchLike;

	constructor(options: ZernioOptions) {
		this.apiKey = options.apiKey;
		this.endpoint = `${options.apiUrl.replace(/\/+$/, '')}${SEND_PATH}`;
		this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
	}

	async sendMessage(message: WhatsappMessage): Promise<void> {
		const response = await this.fetchImpl(this.endpoint, {
			method: 'POST',
			headers: bearer(this.apiKey),
			// TODO(zernio): confirm the send payload field names.
			body: JSON.stringify({
				from: message.from,
				to: message.to,
				type: 'text',
				text: { body: message.text },
			}),
		});
		if (!response.ok) {
			const detail = await response.text().catch(() => '');
			throw new Error(
				`zernio rejected the WhatsApp message (status ${response.status})${detail ? `: ${detail}` : ''}`,
			);
		}
	}
}

// TODO(zernio): confirm the provisioning response shape.
const provisionResponseSchema = z.object({
	phone_number: z.string(),
	id: z.string().nullish(),
});

export class ZernioProvisioner implements ChannelProvisioner {
	private readonly apiKey: string;
	private readonly endpoint: string;
	private readonly fetchImpl: FetchLike;

	constructor(options: ZernioOptions) {
		this.apiKey = options.apiKey;
		this.endpoint = `${options.apiUrl.replace(/\/+$/, '')}${NUMBERS_PATH}`;
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
		const response = await this.fetchImpl(this.endpoint, {
			method: 'POST',
			headers: bearer(this.apiKey),
			// TODO(zernio): confirm the provisioning request payload.
			body: JSON.stringify({ account_name: input.accountName }),
		});
		if (!response.ok) {
			const detail = await response.text().catch(() => '');
			throw new Error(
				`zernio failed to provision a WhatsApp number (status ${response.status})${detail ? `: ${detail}` : ''}`,
			);
		}
		const parsed = provisionResponseSchema.safeParse(JSON.parse(await response.text()));
		if (!parsed.success) {
			throw new Error('zernio returned an unrecognized provisioning response.');
		}
		const address = normalizePhone(parsed.data.phone_number);
		if (address === '') {
			throw new Error('zernio provisioned a number that is not valid E.164.');
		}
		return { address, providerRef: parsed.data.id ?? '' };
	}
}

/** A WhatsApp sender for the config: real zernio when a key is present, else a no-op. */
export function createWhatsappSender(
	config: Pick<Config, 'ZERNIO_API_KEY' | 'ZERNIO_API_URL'>,
	fetchImpl?: FetchLike,
): WhatsappSender {
	if (!config.ZERNIO_API_KEY) {
		return new NoopWhatsappSender();
	}
	return new ZernioWhatsappSender({
		apiKey: config.ZERNIO_API_KEY,
		apiUrl: config.ZERNIO_API_URL,
		fetchImpl,
	});
}

/** A channel provisioner for the config: real zernio when a key is present, else a no-op. */
export function createWhatsappProvisioner(
	config: Pick<Config, 'ZERNIO_API_KEY' | 'ZERNIO_API_URL'>,
	fetchImpl?: FetchLike,
): ChannelProvisioner {
	if (!config.ZERNIO_API_KEY) {
		return new NoopChannelProvisioner();
	}
	return new ZernioProvisioner({
		apiKey: config.ZERNIO_API_KEY,
		apiUrl: config.ZERNIO_API_URL,
		fetchImpl,
	});
}

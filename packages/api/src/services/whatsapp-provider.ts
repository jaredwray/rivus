import type { Config } from '../config';
import type { ChannelProvisioner } from './channel-provisioning';
import { createPlivoProvisioner, createPlivoWhatsappSender } from './plivo-whatsapp';
import type { FetchLike } from './resend-mailer';
import type { WhatsappSender } from './whatsapp';
import {
	createWhatsappProvisioner as createZernioProvisioner,
	createWhatsappSender as createZernioWhatsappSender,
} from './zernio-whatsapp';

/**
 * Selection of the active WhatsApp provider from the config. Plivo is the
 * primary (its account will also carry the SMS and voice channels later, so
 * one rented number serves every channel); zernio remains wired as the
 * alternative provider and is chosen when only its key is set. With neither
 * configured both factories degrade to no-ops, so the API still boots and
 * tests run without provider credentials. Each provider's webhook route is
 * always registered — inbound is gated by that route's own config, not here.
 *
 * Selection is deliberately global (config-level), not per account: zernio has
 * never been live (its wire format is still `TODO(zernio)`), so no deployment
 * holds numbers from two providers at once. If zernio is brought live alongside
 * Plivo, selection must move to the account's stored channel identity
 * (`providerRef`) so a reply always leaves through the provider that owns the
 * number it is sent from.
 */

type WhatsappProviderConfig = Pick<
	Config,
	| 'PLIVO_AUTH_ID'
	| 'PLIVO_AUTH_TOKEN'
	| 'PLIVO_API_URL'
	| 'PLIVO_WEBHOOK_URL'
	| 'PLIVO_NUMBER_COUNTRY'
	| 'ZERNIO_API_KEY'
	| 'ZERNIO_API_URL'
>;

function plivoConfigured(config: WhatsappProviderConfig): boolean {
	return Boolean(config.PLIVO_AUTH_ID && config.PLIVO_AUTH_TOKEN);
}

/** The active provider's WhatsApp sender: Plivo, else zernio, else a no-op. */
export function createWhatsappSender(
	config: WhatsappProviderConfig,
	fetchImpl?: FetchLike,
): WhatsappSender {
	if (plivoConfigured(config)) {
		return createPlivoWhatsappSender(config, fetchImpl);
	}
	return createZernioWhatsappSender(config, fetchImpl);
}

/** The active provider's number provisioner: Plivo, else zernio, else a no-op. */
export function createWhatsappProvisioner(
	config: WhatsappProviderConfig,
	fetchImpl?: FetchLike,
): ChannelProvisioner {
	if (plivoConfigured(config)) {
		return createPlivoProvisioner(config, fetchImpl);
	}
	return createZernioProvisioner(config, fetchImpl);
}

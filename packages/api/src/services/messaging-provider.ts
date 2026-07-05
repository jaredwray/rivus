import type { Config } from '../config';
import type { ChannelProvisioner } from './channel-provisioning';
import { createPlivoProvisioner, createPlivoSmsSender, createPlivoWhatsappSender } from './plivo';
import type { FetchLike } from './resend-mailer';
import type { SmsSender } from './sms';
import type { WhatsappSender } from './whatsapp';
import {
	createWhatsappProvisioner as createZernioProvisioner,
	createWhatsappSender as createZernioWhatsappSender,
} from './zernio-whatsapp';

/**
 * Selection of the active messaging providers from the config. Plivo is the
 * primary for every phone-number channel (WhatsApp and SMS share the one
 * number it rents; voice will ride the same account later); zernio remains
 * wired as the alternative WhatsApp provider and is chosen when only its key
 * is set. SMS has no zernio path — it is Plivo or a no-op. With nothing
 * configured all factories degrade to no-ops, so the API still boots and tests
 * run without provider credentials. Each provider's webhook route is always
 * registered — inbound is gated by that route's own config, not here.
 *
 * Selection is deliberately global (config-level), not per account: zernio has
 * never been live (its wire format is still `TODO(zernio)`), so no deployment
 * holds numbers from two providers at once. If zernio is brought live alongside
 * Plivo, selection must move to the account's stored channel identity
 * (`providerRef`) so a reply always leaves through the provider that owns the
 * number it is sent from.
 */

type MessagingProviderConfig = Pick<
	Config,
	| 'PLIVO_AUTH_ID'
	| 'PLIVO_AUTH_TOKEN'
	| 'PLIVO_API_URL'
	| 'PLIVO_WEBHOOK_URL'
	| 'PLIVO_SMS_WEBHOOK_URL'
	| 'PLIVO_NUMBER_COUNTRY'
	| 'ZERNIO_API_KEY'
	| 'ZERNIO_API_URL'
>;

function plivoConfigured(config: MessagingProviderConfig): boolean {
	return Boolean(config.PLIVO_AUTH_ID && config.PLIVO_AUTH_TOKEN);
}

/** The active provider's WhatsApp sender: Plivo, else zernio, else a no-op. */
export function createWhatsappSender(
	config: MessagingProviderConfig,
	fetchImpl?: FetchLike,
): WhatsappSender {
	if (plivoConfigured(config)) {
		return createPlivoWhatsappSender(config, fetchImpl);
	}
	return createZernioWhatsappSender(config, fetchImpl);
}

/** The active provider's WhatsApp number provisioner: Plivo, else zernio, else a no-op. */
export function createWhatsappProvisioner(
	config: MessagingProviderConfig,
	fetchImpl?: FetchLike,
): ChannelProvisioner {
	if (plivoConfigured(config)) {
		return createPlivoProvisioner(config, fetchImpl);
	}
	return createZernioProvisioner(config, fetchImpl);
}

/** The SMS sender: Plivo when configured, else a no-op (zernio has no SMS). */
export function createSmsSender(config: MessagingProviderConfig, fetchImpl?: FetchLike): SmsSender {
	return createPlivoSmsSender(config, fetchImpl);
}

/**
 * The SMS number provisioner: Plivo when configured, else the no-op fake. The
 * enable route prefers the sibling channel's Plivo-owned number over renting,
 * so this is only reached when the account holds no shareable number yet.
 */
export function createSmsProvisioner(
	config: MessagingProviderConfig,
	fetchImpl?: FetchLike,
): ChannelProvisioner {
	return createPlivoProvisioner(config, fetchImpl);
}

import type { Config } from '../config';
import type { ChannelProvisioner } from './channel-provisioning';
import {
	createPlivoProvisioner,
	createPlivoSmsSender,
	createPlivoWhatsappSender,
	plivoOwnsRef,
} from './plivo';
import type { FetchLike } from './resend-mailer';
import type { SmsMessage, SmsSender } from './sms';
import {
	createTwilioProvisioner,
	createTwilioSmsSender,
	createTwilioWhatsappSender,
	twilioOwnsRef,
} from './twilio';
import type { WhatsappMessage, WhatsappSender } from './whatsapp';
import {
	createWhatsappProvisioner as createZernioProvisioner,
	createWhatsappSender as createZernioWhatsappSender,
} from './zernio-whatsapp';

/**
 * Selection of the active messaging providers from the config. Twilio is the
 * primary for every phone-number channel (WhatsApp and SMS share the one
 * number it rents; voice rides the same number): new numbers provision through
 * it whenever its credentials are set. Plivo stays fully wired during the
 * migration — accounts still holding Plivo numbers keep working — and zernio
 * remains the alternative WhatsApp provider, chosen when only its key is set.
 * SMS and voice have no zernio path. With nothing configured all factories
 * degrade to no-ops, so the API still boots and tests run without provider
 * credentials. Each provider's webhook route is always registered — inbound is
 * gated by that route's own config, not here.
 *
 * Outbound sends are NOT config-global: mid-migration a deployment holds
 * numbers from two providers at once, and a reply must always leave through
 * the provider that owns the number it is sent from — Twilio cannot send from
 * a Plivo number or vice versa. Each message therefore routes by the sending
 * number's stored fingerprint (`providerRef`: Twilio's `PN…` SID, Plivo's
 * bare digits), falling back to the primary chain when no configured provider
 * claims it (fresh dev fakes, zernio's opaque ids — zernio has never been
 * live; give it a fingerprint here if that changes).
 */

type MessagingProviderConfig = Pick<
	Config,
	| 'TWILIO_ACCOUNT_SID'
	| 'TWILIO_AUTH_TOKEN'
	| 'TWILIO_API_URL'
	| 'TWILIO_WHATSAPP_WEBHOOK_URL'
	| 'TWILIO_SMS_WEBHOOK_URL'
	| 'TWILIO_VOICE_WEBHOOK_URL'
	| 'TWILIO_NUMBER_COUNTRY'
	| 'PLIVO_AUTH_ID'
	| 'PLIVO_AUTH_TOKEN'
	| 'PLIVO_API_URL'
	| 'PLIVO_WEBHOOK_URL'
	| 'PLIVO_SMS_WEBHOOK_URL'
	| 'PLIVO_NUMBER_COUNTRY'
	| 'ZERNIO_API_KEY'
	| 'ZERNIO_API_URL'
>;

function twilioConfigured(config: MessagingProviderConfig): boolean {
	return Boolean(config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN);
}

function plivoConfigured(config: MessagingProviderConfig): boolean {
	return Boolean(config.PLIVO_AUTH_ID && config.PLIVO_AUTH_TOKEN);
}

/** The message shape both channel senders share, as far as routing cares. */
interface RoutableMessage {
	from: string;
	providerRef?: string;
}

/** One owner a message can route to: a fingerprint test and that provider's sender. */
interface SenderRoute<M extends RoutableMessage> {
	owns: (message: M) => boolean;
	sender: { sendMessage(message: M): Promise<void> };
}

/**
 * Routes each message to the provider whose fingerprint the sending number's
 * `providerRef` carries, else to the primary sender. Routes exist only for
 * *configured* providers: a message from a number whose owner has no
 * credentials goes to the primary and fails loudly there — a visible delivery
 * error beats a silent no-op drop.
 */
class RoutingMessageSender<M extends RoutableMessage> {
	constructor(
		private readonly routes: SenderRoute<M>[],
		private readonly primary: { sendMessage(message: M): Promise<void> },
	) {}

	async sendMessage(message: M): Promise<void> {
		for (const route of this.routes) {
			if (route.owns(message)) {
				return route.sender.sendMessage(message);
			}
		}
		return this.primary.sendMessage(message);
	}
}

/** The fingerprint tests, shared by both channels. */
const ownsTwilioNumber = (message: RoutableMessage) => twilioOwnsRef(message.providerRef ?? '');
const ownsPlivoNumber = (message: RoutableMessage) =>
	plivoOwnsRef(message.providerRef ?? '', message.from);

/**
 * The WhatsApp sender: routes each message by the sending number's owner
 * (Twilio or Plivo), with the primary chain — Twilio, else Plivo, else zernio,
 * else a no-op — for numbers neither fingerprint claims.
 */
export function createWhatsappSender(
	config: MessagingProviderConfig,
	fetchImpl?: FetchLike,
): WhatsappSender {
	const routes: SenderRoute<WhatsappMessage>[] = [];
	if (twilioConfigured(config)) {
		routes.push({ owns: ownsTwilioNumber, sender: createTwilioWhatsappSender(config, fetchImpl) });
	}
	if (plivoConfigured(config)) {
		routes.push({ owns: ownsPlivoNumber, sender: createPlivoWhatsappSender(config, fetchImpl) });
	}
	const primary = routes[0]?.sender ?? createZernioWhatsappSender(config, fetchImpl);
	return new RoutingMessageSender(routes, primary);
}

/**
 * The WhatsApp number provisioner for *new* numbers: Twilio, else Plivo, else
 * zernio, else a no-op. (Existing numbers never re-provision — the enable
 * route is idempotent and shares the sibling channels' number.)
 */
export function createWhatsappProvisioner(
	config: MessagingProviderConfig,
	fetchImpl?: FetchLike,
): ChannelProvisioner {
	if (twilioConfigured(config)) {
		return createTwilioProvisioner(config, fetchImpl);
	}
	if (plivoConfigured(config)) {
		return createPlivoProvisioner(config, fetchImpl);
	}
	return createZernioProvisioner(config, fetchImpl);
}

/**
 * The SMS sender: routes each message by the sending number's owner (Twilio
 * or Plivo), with the primary chain — Twilio, else Plivo, else a no-op — for
 * numbers neither fingerprint claims (zernio has no SMS).
 */
export function createSmsSender(config: MessagingProviderConfig, fetchImpl?: FetchLike): SmsSender {
	const routes: SenderRoute<SmsMessage>[] = [];
	if (twilioConfigured(config)) {
		routes.push({ owns: ownsTwilioNumber, sender: createTwilioSmsSender(config, fetchImpl) });
	}
	if (plivoConfigured(config)) {
		routes.push({ owns: ownsPlivoNumber, sender: createPlivoSmsSender(config, fetchImpl) });
	}
	// createPlivoSmsSender self-noops when unconfigured, covering the empty chain.
	const primary = routes[0]?.sender ?? createPlivoSmsSender(config, fetchImpl);
	return new RoutingMessageSender(routes, primary);
}

/**
 * The SMS (and voice) number provisioner for new numbers: Twilio, else Plivo
 * — which self-noops when unconfigured. The enable route prefers a sibling
 * channel's provider-owned number over renting, so this is only reached when
 * the account holds no shareable number yet.
 */
export function createSmsProvisioner(
	config: MessagingProviderConfig,
	fetchImpl?: FetchLike,
): ChannelProvisioner {
	if (twilioConfigured(config)) {
		return createTwilioProvisioner(config, fetchImpl);
	}
	return createPlivoProvisioner(config, fetchImpl);
}

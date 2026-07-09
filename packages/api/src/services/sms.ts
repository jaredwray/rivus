/**
 * The SMS transport seam — the messaging counterpart of {@link WhatsappSender}
 * (`./whatsapp`) and `Mailer`. The scheduling agent and the inbox reply-out both
 * send through this interface, so the provider (Plivo) stays behind an adapter
 * and tests inject a recording or no-op sender.
 */

/** An SMS text message to deliver. */
export interface SmsMessage {
	/** The account's provisioned number (E.164). */
	from: string;
	/** The customer's number (E.164). */
	to: string;
	/** Plain-text message body. */
	text: string;
	/**
	 * The provider's handle for the sending number, as stored on the account's
	 * channel config ('' / absent when unknown) — see {@link WhatsappMessage}
	 * (`./whatsapp`): multi-provider deployments route by the number's owner.
	 */
	providerRef?: string;
}

/** Delivers SMS messages. Implementations reject on delivery failure. */
export interface SmsSender {
	sendMessage(message: SmsMessage): Promise<void>;
}

/**
 * A sender that delivers nothing — used when no Plivo credentials are
 * configured so the API still runs in development and tests without attempting
 * real delivery.
 */
export class NoopSmsSender implements SmsSender {
	async sendMessage(_message: SmsMessage): Promise<void> {
		// Intentionally does nothing.
	}
}

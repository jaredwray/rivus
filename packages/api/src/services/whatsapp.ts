/**
 * The WhatsApp transport seam — the messaging counterpart of {@link Mailer}. The
 * scheduling agent and the inbox reply-out both send through this interface, so
 * the provider (zernio) stays behind an adapter and tests inject a recording or
 * no-op sender.
 */

/** A WhatsApp text message to deliver. */
export interface WhatsappMessage {
	/** The account's provisioned business number (E.164). */
	from: string;
	/** The customer's number (E.164). */
	to: string;
	/** Plain-text message body. */
	text: string;
	/**
	 * The provider's handle for the sending number, as stored on the account's
	 * channel config ('' / absent when unknown). A multi-provider deployment
	 * routes each send through the provider that owns the number (mid-migration,
	 * Twilio and Plivo numbers coexist); single-provider senders ignore it.
	 */
	providerRef?: string;
}

/** Delivers WhatsApp messages. Implementations reject on delivery failure. */
export interface WhatsappSender {
	sendMessage(message: WhatsappMessage): Promise<void>;
}

/**
 * A sender that delivers nothing — used when no zernio key is configured so the
 * API still runs in development and tests without attempting real delivery.
 */
export class NoopWhatsappSender implements WhatsappSender {
	async sendMessage(_message: WhatsappMessage): Promise<void> {
		// Intentionally does nothing.
	}
}

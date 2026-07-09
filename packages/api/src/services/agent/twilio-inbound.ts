import { normalizePhone } from '@rivus/core';
import { z } from 'zod';
import {
	WHATSAPP_FAILED_EVENT,
	WHATSAPP_MESSAGE_EVENT,
	type WhatsappInboundEvent,
} from './whatsapp/inbound';

/**
 * Parsing of Twilio's message webhooks into the canonical channel event —
 * Twilio's counterpart of `./plivo-inbound`. One form-encoded payload family
 * serves both channels: WhatsApp deliveries carry `whatsapp:`-prefixed
 * From/To addresses, SMS deliveries bare E.164, so the channel a hook is
 * configured for is checked against the address shape and cross-channel
 * deliveries are recognized and ignored rather than misrouted. Two kinds of
 * deliveries arrive: inbound customer messages (`MessageSid`/`From`/`To`/
 * `Body`, plus `ProfileName` on WhatsApp) and status callbacks for our own
 * sends (`MessageStatus`, with `ErrorCode` on failures), which land on the
 * StatusCallback URL the senders attach to every message.
 *
 * The canonical event type is {@link WhatsappInboundEvent} — named for the
 * channel that introduced it, structurally channel-neutral; the dispatcher
 * supplies the actual channel.
 */

/** The channels a Twilio hook can be configured for. */
export type TwilioChannel = 'whatsapp' | 'sms';

/** How a Twilio delivery was classified. */
export type TwilioInboundResult =
	/** An event Rivus acts on (inbound message, or a failed delivery). */
	| { kind: 'event'; event: WhatsappInboundEvent }
	/** A recognized delivery Rivus deliberately ignores (e.g. MessageStatus=delivered). */
	| { kind: 'ignored' }
	/** Not a Twilio delivery we understand. */
	| { kind: 'unrecognized' };

// Every field optional: payloads vary by delivery kind, Twilio adds parameters
// without notice, and form-encoded values are always strings.
const twilioPayloadSchema = z.object({
	From: z.string().optional(),
	To: z.string().optional(),
	Body: z.string().optional(),
	MessageSid: z.string().optional(),
	/** The sender's WhatsApp profile name, when Twilio forwards it. */
	ProfileName: z.string().optional(),
	/** Present only on status callbacks: queued|sending|sent|delivered|undelivered|failed|read|canceled. */
	MessageStatus: z.string().optional(),
	ErrorCode: z.union([z.string(), z.number()]).optional(),
});

const WHATSAPP_PREFIX = 'whatsapp:';

/** Whether a Twilio address is WhatsApp-prefixed (`whatsapp:+E164`). */
function isWhatsappAddress(value: string): boolean {
	return value.startsWith(WHATSAPP_PREFIX);
}

/** A Twilio address → canonical E.164 (`whatsapp:` prefix stripped, `+` kept). */
function twilioNumber(value: string | undefined): string {
	const trimmed = (value ?? '').trim();
	if (trimmed === '') {
		return '';
	}
	const bare = trimmed.startsWith(WHATSAPP_PREFIX)
		? trimmed.slice(WHATSAPP_PREFIX.length)
		: trimmed;
	return normalizePhone(bare.startsWith('+') ? bare : `+${bare}`);
}

/**
 * Map a Twilio webhook payload (form-encoded, already parsed to an object)
 * into a canonical {@link WhatsappInboundEvent} for the given channel.
 * Status callbacks for still-in-flight or successful sends are
 * recognized-but-ignored; only `failed`/`undelivered` become the canonical
 * failure event. A delivery whose addresses belong to the other channel (an
 * SMS on the WhatsApp hook, or vice versa) is likewise ignored, never
 * misrouted.
 */
export function parseTwilioInbound(body: unknown, channel: TwilioChannel): TwilioInboundResult {
	const parsed = twilioPayloadSchema.safeParse(body);
	if (!parsed.success) {
		return { kind: 'unrecognized' };
	}
	const payload = parsed.data;
	// The whatsapp: prefix on From/To is the channel discriminator.
	const whatsappShaped = isWhatsappAddress((payload.From ?? '').trim());

	// A status callback for a message Rivus sent. `From` is the account's
	// business number (the outbound sender), `To` the customer it failed to reach.
	if (payload.MessageStatus !== undefined) {
		if (whatsappShaped !== (channel === 'whatsapp')) {
			return { kind: 'ignored' };
		}
		const status = payload.MessageStatus.trim().toLowerCase();
		if (status !== 'failed' && status !== 'undelivered') {
			return { kind: 'ignored' };
		}
		return {
			kind: 'event',
			event: {
				type: WHATSAPP_FAILED_EVENT,
				data: {
					from: twilioNumber(payload.From),
					to: twilioNumber(payload.To),
					reason: payload.ErrorCode !== undefined ? String(payload.ErrorCode) : status,
				},
			},
		};
	}

	// An inbound message. Unreadable numbers mean this isn't a delivery we
	// understand at all; a readable delivery shaped like the other channel is
	// recognized and ignored (a hook only handles its own channel).
	const from = twilioNumber(payload.From);
	const to = twilioNumber(payload.To);
	if (from === '' || to === '') {
		return { kind: 'unrecognized' };
	}
	if (whatsappShaped !== (channel === 'whatsapp')) {
		return { kind: 'ignored' };
	}
	// A media-only message has an empty Body, which the dispatcher declines as
	// unsupported — same policy as the Plivo path.
	return {
		kind: 'event',
		event: {
			type: WHATSAPP_MESSAGE_EVENT,
			data: {
				to,
				from,
				text: payload.Body ?? '',
				messageId: payload.MessageSid ?? '',
				profileName: payload.ProfileName ?? '',
			},
		},
	};
}

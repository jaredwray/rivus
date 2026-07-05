import { normalizePhone } from '@rivus/core';
import { z } from 'zod';
import {
	WHATSAPP_FAILED_EVENT,
	WHATSAPP_MESSAGE_EVENT,
	type WhatsappInboundEvent,
} from './inbound';

/**
 * Parsing of Plivo's WhatsApp webhook into the same canonical channel event the
 * zernio parser produces, so the two provider routes share every downstream
 * step. All knowledge of Plivo's field names lives here. Plivo posts two kinds
 * of deliveries to the webhook: inbound customer messages (`From`/`To`/
 * `MessageUUID` plus `Text`, or `ContentType` + `Body` on WhatsApp-flavored
 * payloads) and delivery reports for our own sends (`Status`), which arrive on
 * the callback URL the sender attaches to every message.
 */

/** How a Plivo delivery was classified. */
export type PlivoInboundResult =
	/** An event Rivus acts on (inbound message, or a failed delivery). */
	| { kind: 'event'; event: WhatsappInboundEvent }
	/** A recognized delivery Rivus deliberately ignores (e.g. Status=delivered). */
	| { kind: 'ignored' }
	/** Not a Plivo delivery we understand. */
	| { kind: 'unrecognized' };

// Every field optional: real deliveries vary by message kind, and the form-
// encoded variants carry only strings. Unknown keys are stripped, not rejected.
const plivoPayloadSchema = z.object({
	From: z.string().optional(),
	To: z.string().optional(),
	/** Channel discriminator on inbound messages: sms | mms | whatsapp. */
	Type: z.string().optional(),
	/** WhatsApp payload kind: text | media | location | button | ... */
	ContentType: z.string().optional(),
	/** Message text on SMS-shaped payloads. */
	Text: z.string().optional(),
	/** Message text on WhatsApp-shaped payloads. */
	Body: z.string().optional(),
	MessageUUID: z.union([z.string(), z.number()]).optional(),
	/** The customer's WhatsApp profile name, when Plivo forwards it. */
	ProfileName: z.string().optional(),
	/** Present only on delivery reports: queued|sent|delivered|undelivered|failed|read. */
	Status: z.string().optional(),
	ErrorCode: z.union([z.string(), z.number()]).optional(),
});

/**
 * Plivo delivers numbers as bare E.164 digits ("14155551234"); the canonical
 * event (and the account's stored address) uses the `+` form. A value that
 * already carries `+` passes through; anything unparseable becomes `''`.
 */
function plivoNumber(value: string | undefined): string {
	const trimmed = (value ?? '').trim();
	if (trimmed === '') {
		return '';
	}
	return normalizePhone(trimmed.startsWith('+') ? trimmed : `+${trimmed}`);
}

/**
 * Map a Plivo webhook payload (JSON- or form-encoded, already parsed to an
 * object) into a canonical {@link WhatsappInboundEvent}. Delivery reports for
 * still-in-flight or successful sends are recognized-but-ignored; only
 * `failed`/`undelivered` become the canonical failure event.
 */
export function parsePlivoInbound(body: unknown): PlivoInboundResult {
	const parsed = plivoPayloadSchema.safeParse(body);
	if (!parsed.success) {
		return { kind: 'unrecognized' };
	}
	const payload = parsed.data;

	// A delivery report for a message Rivus sent. `From` is the account's
	// business number (the outbound sender), `To` the customer it failed to reach.
	if (payload.Status !== undefined) {
		const status = payload.Status.trim().toLowerCase();
		if (status !== 'failed' && status !== 'undelivered') {
			return { kind: 'ignored' };
		}
		return {
			kind: 'event',
			event: {
				type: WHATSAPP_FAILED_EVENT,
				data: {
					from: plivoNumber(payload.From),
					to: plivoNumber(payload.To),
					reason: payload.ErrorCode !== undefined ? String(payload.ErrorCode) : status,
				},
			},
		};
	}

	// An inbound message. The same Plivo application can also front SMS; a
	// non-WhatsApp message on this hook is recognized and ignored, not an error.
	if (payload.Type !== undefined && payload.Type.trim().toLowerCase() !== 'whatsapp') {
		return { kind: 'ignored' };
	}
	const from = plivoNumber(payload.From);
	const to = plivoNumber(payload.To);
	if (from === '' || to === '') {
		return { kind: 'unrecognized' };
	}
	// Text lives in `Body` on WhatsApp-shaped payloads and `Text` on SMS-shaped
	// ones; a non-text ContentType (media/location/button) yields '' so the route
	// declines it as unsupported, exactly like the zernio path.
	const contentType = (payload.ContentType ?? 'text').trim().toLowerCase();
	const text = contentType === 'text' ? (payload.Body ?? payload.Text ?? '') : '';
	return {
		kind: 'event',
		event: {
			type: WHATSAPP_MESSAGE_EVENT,
			data: {
				to,
				from,
				text,
				messageId: payload.MessageUUID !== undefined ? String(payload.MessageUUID) : '',
				profileName: payload.ProfileName ?? '',
			},
		},
	};
}

import { z } from 'zod';

/**
 * Parsing of zernio's WhatsApp webhook into a canonical channel event. All
 * knowledge of zernio's wire format lives here (marked `TODO(zernio)`), so the
 * route and orchestrator see only the normalized event and finalizing against
 * zernio's real docs touches only this module.
 */

/** A customer sent an inbound WhatsApp message to the account's business number. */
export const WHATSAPP_MESSAGE_EVENT = 'whatsapp.message.received';
/** A message Rivus sent could not be delivered. */
export const WHATSAPP_FAILED_EVENT = 'whatsapp.message.failed';

/** The canonical inbound event, after mapping from zernio's payload. */
export const whatsappInboundEventSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal(WHATSAPP_MESSAGE_EVENT),
		data: z.object({
			/** The account's business number the message was sent to (E.164-ish). */
			to: z.string().default(''),
			/** The customer's number (E.164-ish). */
			from: z.string().default(''),
			/** Message text; '' for non-text messages (which the route declines). */
			text: z.string().default(''),
			/** Provider message id — the dedup key. */
			messageId: z.string().default(''),
			/** The customer's WhatsApp profile name, when present. */
			profileName: z.string().default(''),
		}),
	}),
	z.object({
		type: z.literal(WHATSAPP_FAILED_EVENT),
		data: z.object({
			/** The account's business number the failed message was sent from. */
			from: z.string().default(''),
			/** The customer's number the message failed to reach. */
			to: z.string().default(''),
			reason: z.string().default(''),
		}),
	}),
]);
export type WhatsappInboundEvent = z.infer<typeof whatsappInboundEventSchema>;

/**
 * Map a zernio webhook payload into a canonical {@link WhatsappInboundEvent},
 * or null when it isn't a delivery we handle. zernio's exact payload is TBD, so
 * v1 validates a payload already shaped like the canonical event (which is what
 * the local `curl`/test flow posts); the real zernio field mapping slots in here.
 *
 * TODO(zernio): translate zernio's actual webhook body (message envelope, media
 * types, status callbacks) into the canonical event.
 */
export function parseZernioInbound(body: unknown): WhatsappInboundEvent | null {
	const parsed = whatsappInboundEventSchema.safeParse(body);
	return parsed.success ? parsed.data : null;
}

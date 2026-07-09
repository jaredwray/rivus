import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type TwilioWebhookParams, verifyTwilioSignature } from '../services/twilio';
import { headerValue, requestOrigin } from './webhook-http';

/**
 * The authenticity gate shared by the Twilio webhook routes (WhatsApp, SMS,
 * voice). Twilio signs the request URL **plus every form parameter**
 * (X-Twilio-Signature), so unlike the Plivo gate this must run at
 * `preValidation` — after the form body is parsed — and hand the whole
 * parameter set to the verifier. Registered per route plugin with that
 * channel's pinned public URL.
 */

/**
 * Every string(-array) field of the parsed form body — Twilio signs all of
 * them, including every occurrence of a repeated key (the form parser keeps
 * repeats as arrays).
 */
function formParams(body: unknown): TwilioWebhookParams {
	if (body === null || typeof body !== 'object') {
		return {};
	}
	const params: TwilioWebhookParams = {};
	for (const [key, value] of Object.entries(body)) {
		if (typeof value === 'string') {
			params[key] = value;
		} else if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
			params[key] = value;
		}
	}
	return params;
}

/**
 * Build the `preValidation` hook for one Twilio channel webhook. `pinnedUrl`
 * is that channel's public webhook URL (`TWILIO_*_WEBHOOK_URL`); when unset
 * the URL is reconstructed from the request, honoring forwarding headers.
 * Voice pins the answer endpoint's URL, so its input endpoint (different
 * path) always verifies against the reconstructed URL — pass `pinnedUrl`
 * only when it matches the route's own path.
 */
export function twilioWebhookAuthHook(
	app: FastifyInstance,
	pinnedUrl: string | undefined,
): (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined> {
	const { config } = app.deps;
	return async (request, reply) => {
		if (request.method !== 'POST') {
			return;
		}
		const authToken = config.TWILIO_AUTH_TOKEN;
		// Same predicate as the provider factories: with a partial credential pair
		// the sender is a silent no-op, so production refuses deliveries it could
		// never answer rather than acknowledging them into a black hole.
		if (config.NODE_ENV === 'production' && !(config.TWILIO_ACCOUNT_SID && authToken)) {
			return reply.code(503).send({
				error: 'Service Unavailable',
				message:
					'The channel is not configured (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must both be set).',
				statusCode: 503,
			});
		}
		// Unconfigured outside production: accept unsigned deliveries (local curls).
		if (!authToken) {
			return;
		}
		const url = pinnedUrl || `${requestOrigin(request)}${request.raw.url ?? request.url}`;
		const verified = verifyTwilioSignature({
			authToken,
			url,
			params: formParams(request.body),
			signature: headerValue(request.headers['x-twilio-signature']),
		});
		if (!verified) {
			throw app.httpErrors.unauthorized('Invalid webhook signature');
		}
	};
}

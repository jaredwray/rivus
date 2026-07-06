import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyPlivoSignature } from '../services/plivo';

/**
 * The authenticity gate shared by the Plivo webhook routes (WhatsApp and SMS).
 * Plivo V2 signs the webhook URL + a nonce with the account's auth token — the
 * body is not part of the signature — so unlike the zernio route (whose scheme
 * signs the raw body and must wait for it), this runs at `onRequest`: an
 * unauthenticated delivery is rejected before the body parser does any work on
 * it. Registered per route plugin, once per channel, with that channel's
 * pinned public URL.
 */

/** First value of a possibly-repeated header, as a string. */
function headerValue(value: string | string[] | undefined): string {
	if (Array.isArray(value)) {
		return value[0] ?? '';
	}
	return value ?? '';
}

/**
 * The public origin of a request (`https://api.rivus.ai`), honoring the
 * forwarding headers the front-door proxy sets. Used to reconstruct signed
 * webhook URLs and to build absolute callback URLs (the voice route's
 * `GetInput action`).
 */
export function requestOrigin(request: FastifyRequest): string {
	const proto = headerValue(request.headers['x-forwarded-proto']) || request.protocol;
	const host = headerValue(request.headers['x-forwarded-host']) || request.headers.host || '';
	return `${proto}://${host}`;
}

/**
 * The URL Plivo signed. The pinned URL (the exact URL configured in the Plivo
 * console for this channel) wins; otherwise it is derived from the request,
 * honoring the forwarding headers the front-door proxy sets.
 */
function requestUrl(request: FastifyRequest, pinned: string | undefined): string {
	if (pinned) {
		return pinned;
	}
	return `${requestOrigin(request)}${request.raw.url ?? request.url}`;
}

/**
 * Build the `onRequest` hook for one Plivo channel webhook. `pinnedUrl` is that
 * channel's public webhook URL (`PLIVO_WEBHOOK_URL` / `PLIVO_SMS_WEBHOOK_URL`).
 */
export function plivoWebhookAuthHook(
	app: FastifyInstance,
	pinnedUrl: string | undefined,
): (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined> {
	const { config } = app.deps;
	return async (request, reply) => {
		if (request.method !== 'POST') {
			return;
		}
		const authToken = config.PLIVO_AUTH_TOKEN;
		// Same predicate as the provider factories: with a partial credential pair
		// the sender is a silent no-op, so production refuses deliveries it could
		// never answer rather than acknowledging them into a black hole.
		if (config.NODE_ENV === 'production' && !(config.PLIVO_AUTH_ID && authToken)) {
			return reply.code(503).send({
				error: 'Service Unavailable',
				message:
					'The channel is not configured (PLIVO_AUTH_ID and PLIVO_AUTH_TOKEN must both be set).',
				statusCode: 503,
			});
		}
		// Unconfigured outside production: accept unsigned deliveries (local curls).
		if (!authToken) {
			return;
		}
		const verified = verifyPlivoSignature({
			authToken,
			url: requestUrl(request, pinnedUrl),
			nonce: headerValue(request.headers['x-plivo-signature-v2-nonce']),
			signature: headerValue(request.headers['x-plivo-signature-v2']),
			maSignature: headerValue(request.headers['x-plivo-signature-ma-v2']),
		});
		if (!verified) {
			throw app.httpErrors.unauthorized('Invalid webhook signature');
		}
	};
}

/**
 * Parse Plivo's form-encoded callback variant to the same plain-object shape as
 * JSON, so the payload mapper sees one input. Registered plugin-scoped by each
 * Plivo route. TODO(plivo): confirm whether the hooks also use JSON in
 * production — both are accepted either way.
 */
export function plivoFormBodyParser(
	_request: FastifyRequest,
	payload: string,
	done: (error: Error | null, result?: unknown) => void,
): void {
	done(null, Object.fromEntries(new URLSearchParams(payload)));
}

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponseSchema } from '../http-schemas';
import { defaultCapabilities } from '../services/agent/capabilities';
import { createWhatsappChannelAdapter } from '../services/agent/whatsapp/adapter';
import { parsePlivoInbound } from '../services/agent/whatsapp/plivo-inbound';
import { verifyPlivoSignature } from '../services/plivo-whatsapp';
import { dispatchWhatsappEvent, whatsappWebhookResponseSchema } from './agent-whatsapp-shared';

/**
 * The Plivo edge of the scheduling agent's WhatsApp channel. Plivo posts two
 * kinds of deliveries here: inbound customer messages (the webhook configured
 * on the WhatsApp Business Account in the Plivo console) and delivery reports
 * for Rivus's own sends (the callback URL the sender attaches to every
 * message). This route owns only the Plivo-specific edges — V2 signature
 * verification (URL + nonce, keyed by the auth token; there is no separate
 * webhook secret) and the payload shape, including Plivo's form-encoded
 * variant — then hands the canonical event to {@link dispatchWhatsappEvent},
 * the same shared body the zernio route uses.
 *
 * Everything unactionable answers `200 {handled:false}` (never a non-2xx that
 * would make Plivo redeliver something that will never become actionable).
 */

/** First value of a possibly-repeated header, as a string. */
function headerValue(value: string | string[] | undefined): string {
	if (Array.isArray(value)) {
		return value[0] ?? '';
	}
	return value ?? '';
}

/**
 * The URL Plivo signed. `PLIVO_WEBHOOK_URL` (the exact URL configured in the
 * Plivo console) pins it; otherwise it is derived from the request, honoring
 * the forwarding headers the front-door proxy sets.
 */
function requestUrl(request: FastifyRequest, configured: string | undefined): string {
	if (configured) {
		return configured;
	}
	const proto = headerValue(request.headers['x-forwarded-proto']) || request.protocol;
	const host = headerValue(request.headers['x-forwarded-host']) || request.headers.host || '';
	return `${proto}://${host}${request.raw.url ?? request.url}`;
}

export const agentWhatsappPlivoRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();
	const {
		config,
		accounts,
		customers,
		conversations,
		agentThreads,
		memberships,
		notifier,
		whatsappSender,
		jobs,
	} = app.deps;

	const adapter = createWhatsappChannelAdapter({ customers, sender: whatsappSender });
	const capabilities = defaultCapabilities();
	const dispatchDeps = {
		config,
		accounts,
		conversations,
		agentThreads,
		memberships,
		notifier,
		jobs,
	};

	// Plivo's message callbacks arrive form-encoded; parse them to the same plain
	// object shape as JSON so the payload mapper sees one input. Plugin-scoped, so
	// no other route inherits it. TODO(plivo): confirm whether the WhatsApp hook
	// also uses JSON in production — both are accepted here either way.
	app.addContentTypeParser(
		'application/x-www-form-urlencoded',
		{ parseAs: 'string' },
		(_request, payload, done) => {
			done(null, Object.fromEntries(new URLSearchParams(payload as string)));
		},
	);

	// Authenticity gate. Plivo V2 signs the webhook URL + a nonce with the
	// account's auth token — the body is not part of the signature — so unlike the
	// zernio route (whose scheme signs the raw body and must wait for it), this
	// runs at onRequest: an unauthenticated delivery is rejected before the body
	// parser does any work on it.
	app.addHook('onRequest', async (request, reply) => {
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
					'The WhatsApp channel is not configured (PLIVO_AUTH_ID and PLIVO_AUTH_TOKEN must both be set).',
				statusCode: 503,
			});
		}
		// Unconfigured outside production: accept unsigned deliveries (local curls).
		if (!authToken) {
			return;
		}
		const verified = verifyPlivoSignature({
			authToken,
			url: requestUrl(request, config.PLIVO_WEBHOOK_URL),
			nonce: headerValue(request.headers['x-plivo-signature-v2-nonce']),
			signature: headerValue(request.headers['x-plivo-signature-v2']),
			maSignature: headerValue(request.headers['x-plivo-signature-ma-v2']),
		});
		if (!verified) {
			throw app.httpErrors.unauthorized('Invalid webhook signature');
		}
	});

	app.post(
		'/whatsapp/plivo/inbound',
		{
			schema: {
				tags: ['channels'],
				summary: 'Plivo WhatsApp webhook (inbound customer messages + delivery status)',
				description:
					'Plivo delivers WhatsApp events for the account’s provisioned business ' +
					'number here: inbound customer messages, and delivery reports for messages ' +
					'Rivus sent (the sender passes this URL as the status callback). On an ' +
					'inbound message Rivus validates the sender against the account’s customers ' +
					'(by phone), keeps the multi-turn scheduling state on the thread, and replies ' +
					'over WhatsApp. On a failed delivery it flags the conversation for a human. ' +
					'Deliveries are authenticated with Plivo’s V2 signature headers when ' +
					'PLIVO_AUTH_TOKEN is configured.',
				body: z.unknown(),
				response: {
					200: whatsappWebhookResponseSchema,
					401: errorResponseSchema,
					503: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const result = parsePlivoInbound(request.body);
			if (result.kind === 'unrecognized') {
				return { handled: false, outcome: 'unrecognized_payload' };
			}
			if (result.kind === 'ignored') {
				return { handled: false, outcome: 'ignored_event_type' };
			}
			return dispatchWhatsappEvent({
				deps: dispatchDeps,
				adapter,
				capabilities,
				event: result.event,
				logger: request.log,
			});
		},
	);
};

import type { FastifyError, FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponseSchema } from '../http-schemas';
import { defaultCapabilities } from '../services/agent/capabilities';
import { createWhatsappChannelAdapter } from '../services/agent/whatsapp/adapter';
import { parseZernioInbound } from '../services/agent/whatsapp/inbound';
import { verifyZernioSignature } from '../services/zernio-whatsapp';
import { channelWebhookResponseSchema, dispatchPhoneChannelEvent } from './agent-phone-shared';

/**
 * The zernio edge of the scheduling agent's WhatsApp channel: zernio posts every
 * message to the account's provisioned business number here. This route owns
 * only the zernio-specific edges — signature verification, the verify-token
 * handshake, and the zernio payload shape — then hands the canonical event to
 * {@link dispatchPhoneChannelEvent}, the same shared body the Plivo route uses, so
 * WhatsApp inherits scheduling, the inbox, FAQ drafts, and delivery-failure
 * handling with no channel-specific feature code.
 *
 * Everything unactionable answers `200 {handled:false}` (never a non-2xx that
 * would make zernio redeliver something that will never become actionable).
 */

const verifyQuerySchema = z.object({
	'hub.mode': z.string().optional(),
	'hub.verify_token': z.string().optional(),
	'hub.challenge': z.string().optional(),
});

/** First value of a possibly-repeated header, as a string. */
function headerValue(value: string | string[] | undefined): string {
	if (Array.isArray(value)) {
		return value[0] ?? '';
	}
	return value ?? '';
}

export const agentWhatsappRoutes: FastifyPluginAsync = async (fastify) => {
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
		faqs,
		faqAnswer,
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
		faqs,
		faqAnswer,
	};

	// Raw body kept byte-for-byte for signature verification (see the email route).
	const rawBodies = new WeakMap<FastifyRequest, string>();
	app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, payload, done) => {
		rawBodies.set(request as FastifyRequest, payload as string);
		try {
			done(null, JSON.parse(payload as string));
		} catch {
			const error = new Error('Body is not valid JSON') as FastifyError;
			error.statusCode = 400;
			done(error, undefined);
		}
	});

	// Authenticity gate for the POST webhook, before any parsing.
	app.addHook('preValidation', async (request, reply) => {
		if (request.method !== 'POST') {
			return;
		}
		const secret = config.ZERNIO_WEBHOOK_SECRET;
		if (!secret) {
			if (config.NODE_ENV === 'production') {
				return reply.code(503).send({
					error: 'Service Unavailable',
					message: 'The WhatsApp channel is not configured (ZERNIO_WEBHOOK_SECRET is unset).',
					statusCode: 503,
				});
			}
			return;
		}
		// zernio signs the raw body with HMAC-SHA256 and sends the lowercase hex
		// digest in X-Zernio-Signature (legacy deliveries: X-Late-Signature).
		const signature =
			headerValue(request.headers['x-zernio-signature']) ||
			headerValue(request.headers['x-late-signature']);
		const verified = verifyZernioSignature({
			secret,
			signature,
			payload: rawBodies.get(request) ?? '',
		});
		if (!verified) {
			throw app.httpErrors.unauthorized('Invalid webhook signature');
		}
	});

	// Provider webhook-registration handshake: echo the challenge when the verify
	// token matches. Inert (404) until ZERNIO_VERIFY_TOKEN is configured.
	// TODO(zernio): confirm whether zernio uses this Meta-style handshake.
	app.get(
		'/whatsapp/inbound',
		{
			schema: {
				tags: ['channels'],
				summary: 'zernio WhatsApp webhook verification handshake',
				querystring: verifyQuerySchema,
				response: { 200: z.string(), 404: errorResponseSchema },
			},
		},
		async (request, reply) => {
			const token = config.ZERNIO_VERIFY_TOKEN;
			const query = request.query;
			if (token && query['hub.verify_token'] === token && query['hub.challenge'] !== undefined) {
				return reply.code(200).send(query['hub.challenge']);
			}
			throw app.httpErrors.notFound('Not found');
		},
	);

	app.post(
		'/whatsapp/inbound',
		{
			schema: {
				tags: ['channels'],
				summary: 'zernio WhatsApp webhook (inbound customer messages + delivery status)',
				description:
					'zernio delivers WhatsApp events for the account’s provisioned business ' +
					'number here. On an inbound message Rivus validates the sender against the ' +
					'account’s customers (by phone), keeps the multi-turn scheduling state on the ' +
					'thread, and replies over WhatsApp. On a delivery failure it flags the ' +
					'conversation for a human. Deliveries are authenticated with the signature ' +
					'header when ZERNIO_WEBHOOK_SECRET is configured.',
				body: z.unknown(),
				response: {
					200: channelWebhookResponseSchema,
					401: errorResponseSchema,
					503: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const event = parseZernioInbound(request.body);
			if (!event) {
				return { handled: false, outcome: 'unrecognized_payload' };
			}
			return dispatchPhoneChannelEvent({
				deps: dispatchDeps,
				channel: 'whatsapp',
				adapter,
				capabilities,
				event,
				logger: request.log,
			});
		},
	);
};

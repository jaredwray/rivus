import { normalizePhone } from '@rivus/core';
import type { FastifyError, FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponseSchema } from '../http-schemas';
import { defaultCapabilities } from '../services/agent/capabilities';
import type { InboundAgentMessage } from '../services/agent/channel';
import { flagDeliveryFailure, handleInboundAgentMessage } from '../services/agent/orchestrator';
import { createWhatsappChannelAdapter } from '../services/agent/whatsapp/adapter';
import {
	parseZernioInbound,
	WHATSAPP_FAILED_EVENT,
	WHATSAPP_MESSAGE_EVENT,
} from '../services/agent/whatsapp/inbound';
import { verifyZernioSignature } from '../services/zernio-whatsapp';

/**
 * The WhatsApp channel of the scheduling agent: zernio posts every message to the
 * account's provisioned business number here. This route owns only the WhatsApp
 * edges — signature verification, the verify-token handshake, the zernio payload
 * shape, resolving the account from the business number, and the loop/unsupported
 * guards — then hands a normalized {@link InboundAgentMessage} to the same
 * channel-agnostic {@link handleInboundAgentMessage} the email channel uses, so
 * WhatsApp inherits scheduling, the inbox, FAQ drafts, and delivery-failure
 * handling with no channel-specific feature code.
 *
 * Everything unactionable answers `200 {handled:false}` (never a non-2xx that
 * would make zernio redeliver something that will never become actionable).
 */

const webhookResponseSchema = z
	.object({
		handled: z.boolean(),
		outcome: z.string(),
	})
	.meta({ id: 'AgentWhatsappWebhookResult' });

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
	} = app.deps;

	const adapter = createWhatsappChannelAdapter({ customers, sender: whatsappSender });
	const capabilities = defaultCapabilities();
	const orchestratorDeps = { config, jobs, conversations, agentThreads };

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
					200: webhookResponseSchema,
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

			// Delivery failure: a message Rivus sent never reached the customer.
			if (event.type === WHATSAPP_FAILED_EVENT) {
				const businessNumber = normalizePhone(event.data.from);
				const account = await accounts.findByChannelAddress('whatsapp', businessNumber);
				if (!account || account.status === 'canceled') {
					return { handled: false, outcome: 'unknown_account' };
				}
				const customerNumber = normalizePhone(event.data.to);
				if (customerNumber === '') {
					return { handled: false, outcome: 'unparseable_recipient' };
				}
				return flagDeliveryFailure({
					deps: { conversations, agentThreads, memberships, notifier },
					account,
					channel: 'whatsapp',
					contactAddress: customerNumber,
					noteBody: `Rivus's last WhatsApp message to ${customerNumber} couldn't be delivered — follow up another way.`,
					outcome: 'delivery_failed',
					logger: request.log,
				});
			}

			if (event.type !== WHATSAPP_MESSAGE_EVENT) {
				return { handled: false, outcome: 'ignored_event_type' };
			}

			// Which account owns the business number this was sent to?
			const businessNumber = normalizePhone(event.data.to);
			const account = await accounts.findByChannelAddress('whatsapp', businessNumber);
			if (!account || account.status === 'canceled') {
				return { handled: false, outcome: 'unknown_account' };
			}
			// A disabled channel is off: acknowledge without replying (never a retry).
			if (!account.channels.whatsapp.enabled) {
				return { handled: false, outcome: 'channel_disabled' };
			}

			const senderNumber = normalizePhone(event.data.from);
			if (senderNumber === '') {
				return { handled: false, outcome: 'unparseable_sender' };
			}
			// Loop guard: never converse with any account's own business number, so two
			// Rivus accounts can't schedule each other forever.
			if (await accounts.findByChannelAddress('whatsapp', senderNumber)) {
				return { handled: false, outcome: 'own_number' };
			}
			// v1 handles text only; a media/location/voice message gets no reply.
			if (event.data.text.trim() === '') {
				return { handled: false, outcome: 'unsupported_message_type' };
			}

			const message: InboundAgentMessage = {
				sender: { address: senderNumber, name: event.data.profileName },
				text: event.data.text,
				subject: '',
				externalMessageId: event.data.messageId,
			};
			return handleInboundAgentMessage({
				deps: orchestratorDeps,
				adapter,
				capabilities,
				account,
				message,
				logger: request.log,
			});
		},
	);
};

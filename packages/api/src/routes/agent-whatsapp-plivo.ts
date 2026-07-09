import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponseSchema } from '../http-schemas';
import { defaultCapabilities } from '../services/agent/capabilities';
import { parsePlivoInbound } from '../services/agent/plivo-inbound';
import { createWhatsappChannelAdapter } from '../services/agent/whatsapp/adapter';
import { channelWebhookResponseSchema, dispatchPhoneChannelEvent } from './agent-phone-shared';
import { plivoWebhookAuthHook } from './plivo-webhook-auth';
import { formUrlencodedParser } from './webhook-http';

/**
 * The Plivo edge of the scheduling agent's WhatsApp channel. Plivo posts two
 * kinds of deliveries here: inbound customer messages (the webhook configured
 * on the WhatsApp Business Account in the Plivo console) and delivery reports
 * for Rivus's own sends (the callback URL the sender attaches to every
 * message). This route owns only the Plivo-specific edges — the shared V2
 * signature gate and the payload shape, including Plivo's form-encoded
 * variant — then hands the canonical event to {@link dispatchPhoneChannelEvent},
 * the same shared body the zernio and SMS routes use.
 *
 * Everything unactionable answers `200 {handled:false}` (never a non-2xx that
 * would make Plivo redeliver something that will never become actionable).
 */

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

	app.addContentTypeParser(
		'application/x-www-form-urlencoded',
		{ parseAs: 'string' },
		formUrlencodedParser,
	);
	app.addHook('onRequest', plivoWebhookAuthHook(app, config.PLIVO_WEBHOOK_URL));

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
					200: channelWebhookResponseSchema,
					401: errorResponseSchema,
					503: errorResponseSchema,
				},
			},
		},
		async (request) => {
			const result = parsePlivoInbound(request.body, 'whatsapp');
			if (result.kind === 'unrecognized') {
				return { handled: false, outcome: 'unrecognized_payload' };
			}
			if (result.kind === 'ignored') {
				return { handled: false, outcome: 'ignored_event_type' };
			}
			return dispatchPhoneChannelEvent({
				deps: dispatchDeps,
				channel: 'whatsapp',
				adapter,
				capabilities,
				event: result.event,
				logger: request.log,
			});
		},
	);
};

import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponseSchema } from '../http-schemas';
import { defaultCapabilities } from '../services/agent/capabilities';
import { parsePlivoInbound } from '../services/agent/plivo-inbound';
import { createSmsChannelAdapter } from '../services/agent/sms/adapter';
import { channelWebhookResponseSchema, dispatchPhoneChannelEvent } from './agent-phone-shared';
import { plivoFormBodyParser, plivoWebhookAuthHook } from './plivo-webhook-auth';

/**
 * The Plivo edge of the scheduling agent's SMS channel — the mirror of the
 * Plivo WhatsApp route. Plivo posts two kinds of deliveries here: inbound
 * customer texts (the message_url configured on the number's Plivo
 * application) and delivery reports for Rivus's own sends (the callback URL
 * the sender attaches to every message). The route owns only the Plivo
 * edges — the shared V2 signature gate and payload shape — then hands the
 * canonical event to {@link dispatchPhoneChannelEvent}, so SMS inherits
 * scheduling, the inbox, FAQ drafts, and delivery-failure handling with no
 * channel-specific feature code.
 *
 * Everything unactionable answers `200 {handled:false}` (never a non-2xx that
 * would make Plivo redeliver something that will never become actionable).
 */

export const agentSmsPlivoRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();
	const {
		config,
		accounts,
		customers,
		conversations,
		agentThreads,
		memberships,
		notifier,
		smsSender,
		jobs,
	} = app.deps;

	const adapter = createSmsChannelAdapter({ customers, sender: smsSender });
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
		plivoFormBodyParser,
	);
	app.addHook('onRequest', plivoWebhookAuthHook(app, config.PLIVO_SMS_WEBHOOK_URL));

	app.post(
		'/sms/plivo/inbound',
		{
			schema: {
				tags: ['channels'],
				summary: 'Plivo SMS webhook (inbound customer texts + delivery status)',
				description:
					'Plivo delivers SMS events for the account’s provisioned number here: ' +
					'inbound customer texts, and delivery reports for messages Rivus sent ' +
					'(the sender passes this URL as the status callback). On an inbound text ' +
					'Rivus validates the sender against the account’s customers (by phone), ' +
					'keeps the multi-turn scheduling state on the thread, and replies over ' +
					'SMS. On a failed delivery it flags the conversation for a human. ' +
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
			const result = parsePlivoInbound(request.body, 'sms');
			if (result.kind === 'unrecognized') {
				return { handled: false, outcome: 'unrecognized_payload' };
			}
			if (result.kind === 'ignored') {
				return { handled: false, outcome: 'ignored_event_type' };
			}
			return dispatchPhoneChannelEvent({
				deps: dispatchDeps,
				channel: 'sms',
				adapter,
				capabilities,
				event: result.event,
				logger: request.log,
			});
		},
	);
};

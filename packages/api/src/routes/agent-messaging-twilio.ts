import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Config } from '../config';
import { errorResponseSchema } from '../http-schemas';
import { defaultCapabilities } from '../services/agent/capabilities';
import type { ChannelAdapter } from '../services/agent/channel';
import { createSmsChannelAdapter } from '../services/agent/sms/adapter';
import { parseTwilioInbound, type TwilioChannel } from '../services/agent/twilio-inbound';
import { createWhatsappChannelAdapter } from '../services/agent/whatsapp/adapter';
import type { AppDeps } from '../types';
import { dispatchPhoneChannelEvent } from './agent-phone-shared';
import { twilioWebhookAuthHook } from './twilio-webhook-auth';
import { formUrlencodedParser } from './webhook-http';

/**
 * The Twilio edges of the scheduling agent's WhatsApp and SMS channels — one
 * builder, two registered plugins, because the payloads differ only by the
 * `whatsapp:` address prefix. Twilio posts two kinds of deliveries to each
 * hook: inbound customer messages and status callbacks for Rivus's own sends
 * (the StatusCallback URL the senders attach). Each route owns only the
 * Twilio edges — the shared signature gate and the payload shape — then hands
 * the canonical event to {@link dispatchPhoneChannelEvent}, the same shared
 * body the Plivo and zernio routes use.
 *
 * One Twilio-specific contract: these webhooks answer with **empty TwiML**
 * (`<Response/>`, text/xml), never JSON — Twilio texts a `text/plain` body
 * back to the customer, and it expects a TwiML instruction set in reply. The
 * dispatch outcome is logged instead of returned.
 */

/** Twilio-required acknowledgment: an empty TwiML instruction set. */
const EMPTY_TWIML = '<Response/>';

function buildTwilioMessagingRoutes(options: {
	channel: TwilioChannel;
	path: string;
	summary: string;
	pinnedUrl: (config: Config) => string | undefined;
	adapter: (deps: AppDeps) => ChannelAdapter;
}): FastifyPluginAsync {
	return async (fastify) => {
		const app = fastify.withTypeProvider<ZodTypeProvider>();
		const deps = app.deps;
		const { config, accounts, conversations, agentThreads, memberships, notifier, jobs } = deps;

		const adapter = options.adapter(deps);
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
		app.addHook('preValidation', twilioWebhookAuthHook(app, options.pinnedUrl(config)));

		app.post(
			options.path,
			{
				schema: {
					tags: ['channels'],
					summary: options.summary,
					description:
						'Twilio delivers events for the account’s provisioned number here: inbound ' +
						'customer messages, and status callbacks for messages Rivus sent. The agent ' +
						'handles the message exactly like the other provider edges; the response is ' +
						'always the empty TwiML acknowledgment Twilio expects, with the handling ' +
						'outcome recorded in the logs. Deliveries are authenticated with the ' +
						'X-Twilio-Signature header when TWILIO_AUTH_TOKEN is configured.',
					body: z.unknown(),
					response: {
						200: z.string(),
						401: errorResponseSchema,
						503: errorResponseSchema,
					},
				},
			},
			async (request, reply) => {
				reply.type('text/xml');
				const result = parseTwilioInbound(request.body, options.channel);
				if (result.kind === 'unrecognized') {
					request.log.info(
						{ channel: options.channel, outcome: 'unrecognized_payload' },
						'twilio webhook',
					);
					return EMPTY_TWIML;
				}
				if (result.kind === 'ignored') {
					request.log.info(
						{ channel: options.channel, outcome: 'ignored_event_type' },
						'twilio webhook',
					);
					return EMPTY_TWIML;
				}
				try {
					const outcome = await dispatchPhoneChannelEvent({
						deps: dispatchDeps,
						channel: options.channel,
						adapter,
						capabilities,
						event: result.event,
						logger: request.log,
					});
					request.log.info({ channel: options.channel, ...outcome }, 'twilio webhook');
				} catch (error) {
					// Unlike Plivo, Twilio never redelivers on an error status (its retries
					// cover connection failures only), so a 5xx buys no durability here — it
					// would only swap this ack for provider-side error noise. Log the loss
					// loudly, with enough context to recover the message by hand.
					request.log.error(
						{
							err: error,
							channel: options.channel,
							event: result.event.type,
							from: result.event.data.from,
							to: result.event.data.to,
						},
						'twilio webhook dispatch failed',
					);
				}
				return EMPTY_TWIML;
			},
		);
	};
}

export const agentWhatsappTwilioRoutes = buildTwilioMessagingRoutes({
	channel: 'whatsapp',
	path: '/whatsapp/twilio/inbound',
	summary: 'Twilio WhatsApp webhook (inbound customer messages + delivery status)',
	pinnedUrl: (config) => config.TWILIO_WHATSAPP_WEBHOOK_URL,
	adapter: (deps) =>
		createWhatsappChannelAdapter({ customers: deps.customers, sender: deps.whatsappSender }),
});

export const agentSmsTwilioRoutes = buildTwilioMessagingRoutes({
	channel: 'sms',
	path: '/sms/twilio/inbound',
	summary: 'Twilio SMS webhook (inbound customer texts + delivery status)',
	pinnedUrl: (config) => config.TWILIO_SMS_WEBHOOK_URL,
	adapter: (deps) => createSmsChannelAdapter({ customers: deps.customers, sender: deps.smsSender }),
});

import { normalizePhone } from '@rivus/core';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import type { AgentCapability } from '../services/agent/capabilities';
import type { ChannelAdapter, InboundAgentMessage } from '../services/agent/channel';
import {
	flagDeliveryFailure,
	handleInboundAgentMessage,
	type InboundHandleResult,
} from '../services/agent/orchestrator';
import {
	WHATSAPP_FAILED_EVENT,
	type WhatsappInboundEvent,
} from '../services/agent/whatsapp/inbound';
import type { AppDeps } from '../types';

/**
 * The provider-agnostic body shared by the WhatsApp webhook routes. Each
 * provider route (zernio, Plivo) owns only its edges — signature verification
 * and payload parsing into the canonical {@link WhatsappInboundEvent} — then
 * hands the event here, so account resolution, the loop/unsupported guards,
 * and the orchestrator hand-off can never drift between providers.
 */

/** What the webhook routes need from {@link AppDeps} to dispatch an event. */
export type WhatsappWebhookDeps = Pick<
	AppDeps,
	'config' | 'accounts' | 'conversations' | 'agentThreads' | 'memberships' | 'notifier' | 'jobs'
>;

/** The 200 body both provider webhooks answer with (one shared OpenAPI id). */
export const whatsappWebhookResponseSchema = z
	.object({
		handled: z.boolean(),
		outcome: z.string(),
	})
	.meta({ id: 'AgentWhatsappWebhookResult' });

export async function dispatchWhatsappEvent(options: {
	deps: WhatsappWebhookDeps;
	adapter: ChannelAdapter;
	capabilities: AgentCapability[];
	event: WhatsappInboundEvent;
	logger: FastifyBaseLogger;
}): Promise<InboundHandleResult> {
	const { deps, adapter, capabilities, event, logger } = options;
	const { accounts, conversations, agentThreads, memberships, notifier, config, jobs } = deps;

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
			logger,
		});
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
		deps: { config, jobs, conversations, agentThreads },
		adapter,
		capabilities,
		account,
		message,
		logger,
	});
}

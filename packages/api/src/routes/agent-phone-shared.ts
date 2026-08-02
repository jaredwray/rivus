import { normalizePhone } from '@rivus/core';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import type { AgentCapability, OrchestratorDeps } from '../services/agent/capabilities';
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
 * The provider-agnostic body shared by the phone-number channel webhooks
 * (WhatsApp and SMS). Each provider route (zernio, Plivo×2) owns only its
 * edges — signature verification and payload parsing into the canonical
 * {@link WhatsappInboundEvent} — then hands the event here, so account
 * resolution, the loop/unsupported guards, and the orchestrator hand-off can
 * never drift between providers or channels.
 */

/** The phone-number channels this dispatcher serves. */
export type PhoneChannel = 'whatsapp' | 'sms';

/**
 * What the webhook routes need to dispatch an event: everything the shared
 * orchestrator reads, plus this dispatcher's own extras. Defined as an extension
 * of {@link OrchestratorDeps} rather than a parallel list, so a capability that
 * starts reading another repository widens that type and nothing here (or in the
 * four provider routes) changes.
 */
export type PhoneWebhookDeps = OrchestratorDeps & Pick<AppDeps, 'accounts'>;

/** The 200 body every channel webhook answers with (one shared OpenAPI id). */
export const channelWebhookResponseSchema = z
	.object({
		handled: z.boolean(),
		outcome: z.string(),
	})
	.meta({ id: 'AgentChannelWebhookResult' });

/** How the delivery-failure inbox note names a message on each channel. */
const FAILURE_NOUN: Record<PhoneChannel, string> = {
	whatsapp: 'WhatsApp message',
	sms: 'text message',
};

export async function dispatchPhoneChannelEvent(options: {
	deps: PhoneWebhookDeps;
	channel: PhoneChannel;
	adapter: ChannelAdapter;
	capabilities: AgentCapability[];
	event: WhatsappInboundEvent;
	logger: FastifyBaseLogger;
}): Promise<InboundHandleResult> {
	const { deps, channel, adapter, capabilities, event, logger } = options;
	const { accounts, conversations, agentThreads, memberships, notifier } = deps;

	// Delivery failure: a message Rivus sent never reached the customer.
	if (event.type === WHATSAPP_FAILED_EVENT) {
		const businessNumber = normalizePhone(event.data.from);
		const account = await accounts.findByChannelAddress(channel, businessNumber);
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
			channel,
			contactAddress: customerNumber,
			noteBody: `Rivus's last ${FAILURE_NOUN[channel]} to ${customerNumber} couldn't be delivered — follow up another way.`,
			outcome: 'delivery_failed',
			logger,
		});
	}

	// Which account owns the business number this was sent to?
	const businessNumber = normalizePhone(event.data.to);
	const account = await accounts.findByChannelAddress(channel, businessNumber);
	if (!account || account.status === 'canceled') {
		return { handled: false, outcome: 'unknown_account' };
	}
	// A disabled channel is off: acknowledge without replying (never a retry).
	if (!account.channels[channel].enabled) {
		return { handled: false, outcome: 'channel_disabled' };
	}

	const senderNumber = normalizePhone(event.data.from);
	if (senderNumber === '') {
		return { handled: false, outcome: 'unparseable_sender' };
	}
	// Loop guard: never converse with any account's own business number, so two
	// Rivus accounts can't schedule each other forever.
	if (await accounts.findByChannelAddress(channel, senderNumber)) {
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
		// `PhoneWebhookDeps` extends `OrchestratorDeps`, so the bag passes straight
		// through — no field list here to fall out of date.
		deps,
		adapter,
		capabilities,
		account,
		message,
		logger,
	});
}

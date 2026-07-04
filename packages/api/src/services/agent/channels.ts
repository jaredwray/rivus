import type { ConversationChannel } from '@rivus/core';
import type { AppDeps } from '../../types';
import type { ChannelAdapter } from './channel';
import { createEmailChannelAdapter } from './email/adapter';
import { createWhatsappChannelAdapter } from './whatsapp/adapter';

/**
 * The channel adapters that have an outbound transport, keyed by channel. This is
 * where the inbox reply-out finds the right adapter for a conversation, so a
 * human reply or an approved FAQ draft leaves over the same channel the customer
 * used. A channel with no entry (`phone`, and `sms`/`voice` until they're built)
 * has no transport — the caller records the reply without sending it. Adding a
 * new channel's entry here lights up inbox reply-out for it automatically.
 */
export function createChannelAdapters(
	deps: AppDeps,
): Partial<Record<ConversationChannel, ChannelAdapter>> {
	return {
		email: createEmailChannelAdapter({
			config: deps.config,
			customers: deps.customers,
			mailer: deps.mailer,
		}),
		whatsapp: createWhatsappChannelAdapter({
			customers: deps.customers,
			sender: deps.whatsappSender,
		}),
	};
}

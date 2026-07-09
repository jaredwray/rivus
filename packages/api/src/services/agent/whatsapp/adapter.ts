import type { AccountId, Customer } from '@rivus/core';
import type { CustomerRepository } from '../../../repositories/types';
import type { WhatsappSender } from '../../whatsapp';
import type {
	ChannelAdapter,
	ChannelCapabilities,
	OutboundContext,
	SignupPrefill,
} from '../channel';
import { renderChatResponse } from '../chat-renderer';
import type { AgentResponse } from '../response';

/**
 * The WhatsApp channel adapter: recognize senders by phone (`findByPhone`),
 * render the neutral response as a chat message, and send it through the
 * {@link WhatsappSender}. Like every adapter it holds no feature logic — the
 * scheduling engine, capabilities, and composer upstream decide everything, and
 * this only translates a decision-blind {@link AgentResponse} to WhatsApp.
 */

const WHATSAPP_CAPABILITIES: ChannelCapabilities = {
	channel: 'whatsapp',
	medium: 'chat',
	supportsRichText: false,
	supportsInteractiveOptions: false,
	supportsHyperlinkButtons: false,
	maxTextLength: 4096,
	hasSubjects: false,
	threadingModel: 'session',
	isRealtimeVoice: false,
	supportsAttachments: false,
};

export function createWhatsappChannelAdapter(deps: {
	customers: CustomerRepository;
	sender: WhatsappSender;
}): ChannelAdapter {
	return {
		channel: 'whatsapp',
		capabilities: WHATSAPP_CAPABILITIES,
		findCustomer(accountId: AccountId, contactAddress: string): Promise<Customer | null> {
			return deps.customers.findByPhone(accountId, contactAddress);
		},
		signupPrefill(sender): SignupPrefill {
			return { param: 'phone', value: sender.address };
		},
		async deliver(response: AgentResponse, ctx: OutboundContext): Promise<string> {
			const text = renderChatResponse(response, WHATSAPP_CAPABILITIES);
			await deps.sender.sendMessage({
				from: ctx.account.channels.whatsapp.address,
				to: ctx.to.address,
				text,
				providerRef: ctx.account.channels.whatsapp.providerRef,
			});
			return text;
		},
	};
}

import type { AccountId, Customer } from '@rivus/core';
import type { CustomerRepository } from '../../../repositories/types';
import type { SmsSender } from '../../sms';
import type {
	ChannelAdapter,
	ChannelCapabilities,
	OutboundContext,
	SignupPrefill,
} from '../channel';
import { renderChatResponse } from '../chat-renderer';
import type { AgentResponse } from '../response';

/**
 * The SMS channel adapter: recognize senders by phone (`findByPhone`), render
 * the neutral response as a chat message, and send it through the
 * {@link SmsSender}. Like every adapter it holds no feature logic — the
 * scheduling engine, capabilities, and composer upstream decide everything,
 * and this only translates a decision-blind {@link AgentResponse} to SMS.
 */

const SMS_CAPABILITIES: ChannelCapabilities = {
	channel: 'sms',
	medium: 'chat',
	supportsRichText: false,
	supportsInteractiveOptions: false,
	supportsHyperlinkButtons: false,
	// Ten concatenated GSM segments — the practical carrier budget for one
	// long-code message; the chat renderer truncates beyond it.
	maxTextLength: 1600,
	hasSubjects: false,
	threadingModel: 'session',
	isRealtimeVoice: false,
	supportsAttachments: false,
};

export function createSmsChannelAdapter(deps: {
	customers: CustomerRepository;
	sender: SmsSender;
}): ChannelAdapter {
	return {
		channel: 'sms',
		capabilities: SMS_CAPABILITIES,
		findCustomer(accountId: AccountId, contactAddress: string): Promise<Customer | null> {
			return deps.customers.findByPhone(accountId, contactAddress);
		},
		signupPrefill(sender): SignupPrefill {
			return { param: 'phone', value: sender.address };
		},
		async deliver(response: AgentResponse, ctx: OutboundContext): Promise<string> {
			const text = renderChatResponse(response, SMS_CAPABILITIES);
			await deps.sender.sendMessage({
				from: ctx.account.channels.sms.address,
				to: ctx.to.address,
				text,
			});
			return text;
		},
	};
}

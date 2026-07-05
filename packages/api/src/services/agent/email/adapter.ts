import type { AccountId, Customer } from '@rivus/core';
import type { Config } from '../../../config';
import type { CustomerRepository } from '../../../repositories/types';
import type { Mailer } from '../../email';
import type {
	ChannelAdapter,
	ChannelCapabilities,
	OutboundContext,
	SignupPrefill,
} from '../channel';
import type { AgentResponse } from '../response';
import { agentFromHeader } from './outbound';
import { renderEmailResponse } from './renderer';

/**
 * The email channel adapter: the identity space (recognize senders by email
 * address), the generic renderer (design-system card via
 * {@link renderEmailResponse}), and transport (the account's own agent address
 * through the {@link Mailer}, threaded via In-Reply-To/References). It holds no
 * feature logic — every scheduling/FAQ behavior is decided upstream in the core
 * and reaches it only as a neutral {@link AgentResponse}.
 */

const EMAIL_CAPABILITIES: ChannelCapabilities = {
	channel: 'email',
	medium: 'email',
	supportsRichText: true,
	supportsInteractiveOptions: false,
	supportsHyperlinkButtons: true,
	maxTextLength: null,
	hasSubjects: true,
	threadingModel: 'message-id',
	isRealtimeVoice: false,
	supportsAttachments: false,
};

export function createEmailChannelAdapter(deps: {
	config: Pick<Config, 'AGENT_EMAIL_DOMAIN'>;
	customers: CustomerRepository;
	mailer: Mailer;
}): ChannelAdapter {
	return {
		channel: 'email',
		capabilities: EMAIL_CAPABILITIES,
		findCustomer(accountId: AccountId, contactAddress: string): Promise<Customer | null> {
			return deps.customers.findByEmail(accountId, contactAddress);
		},
		signupPrefill(sender): SignupPrefill {
			return { param: 'email', value: sender.address };
		},
		async deliver(response: AgentResponse, ctx: OutboundContext): Promise<string> {
			const rendered = renderEmailResponse(response, {
				accountName: ctx.account.name,
				inboundSubject: ctx.subject,
			});
			await deps.mailer.sendAgentEmail({
				to: ctx.to.address,
				from: agentFromHeader(ctx.account, deps.config.AGENT_EMAIL_DOMAIN),
				subject: rendered.subject,
				html: rendered.html,
				text: rendered.text,
				inReplyTo: ctx.replyToExternalId,
				references: ctx.replyToExternalId === '' ? [] : [ctx.replyToExternalId],
			});
			// The transcript records the same text the customer received.
			return rendered.text;
		},
	};
}

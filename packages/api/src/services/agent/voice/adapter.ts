import type { AccountId, Customer } from '@rivus/core';
import type { CustomerRepository } from '../../../repositories/types';
import type {
	ChannelAdapter,
	ChannelCapabilities,
	OutboundContext,
	SignupPrefill,
} from '../channel';
import type { AgentResponse } from '../response';
import { renderVoiceResponse } from './renderer';

/**
 * The voice channel adapter. Voice is the one channel whose transport is
 * SYNCHRONOUS: the reply is the XML the webhook answers with, not a message
 * pushed through a provider API. So `deliver` renders the spoken utterance
 * into a per-turn {@link VoiceTurnCapture} the route hands in, and the route
 * speaks it in its HTTP response. Everything else is the standard adapter
 * contract — recognize callers by phone, feature-blind rendering — so the
 * orchestrator (thread state, inbox mirroring, dedup) is reused unchanged.
 *
 * Inbox conversations for calls use the existing `phone` channel, and have no
 * entry in the reply-out registry: with no live call there is nothing to push
 * a human reply through, so inbox replies on phone conversations record only.
 */

/** Where one turn's spoken reply lands (the route speaks it in the response). */
export interface VoiceTurnCapture {
	text: string;
}

const VOICE_CAPABILITIES: ChannelCapabilities = {
	channel: 'phone',
	medium: 'voice',
	supportsRichText: false,
	supportsInteractiveOptions: false,
	supportsHyperlinkButtons: false,
	maxTextLength: null,
	hasSubjects: false,
	threadingModel: 'session',
	isRealtimeVoice: true,
	supportsAttachments: false,
};

export function createVoiceChannelAdapter(deps: {
	customers: CustomerRepository;
	capture: VoiceTurnCapture;
}): ChannelAdapter {
	return {
		channel: 'phone',
		capabilities: VOICE_CAPABILITIES,
		findCustomer(accountId: AccountId, contactAddress: string): Promise<Customer | null> {
			return deps.customers.findByPhone(accountId, contactAddress);
		},
		signupPrefill(sender): SignupPrefill {
			return { param: 'phone', value: sender.address };
		},
		async deliver(response: AgentResponse, _ctx: OutboundContext): Promise<string> {
			const speech = renderVoiceResponse(response);
			deps.capture.text = speech;
			return speech;
		},
	};
}

import type { Account, AccountId, AgentThread, ConversationChannel, Customer } from '@rivus/core';
import type { AgentResponse, ChannelMedium } from './response';

/**
 * The seam every messaging channel plugs into. A channel adapter does exactly
 * three feature-blind things — recognize the sender in its identity space,
 * generically render a neutral {@link AgentResponse}, and transport it — so the
 * channel-agnostic core (engine, capabilities, composer) owns all behavior and a
 * new feature ships on every channel with no adapter change. An adapter that
 * imported `AgentDecision` (or any capability type) would be a layering
 * violation; the interfaces are shaped so it never needs to.
 */

/**
 * What a channel can PRESENT. Renderers and any medium-aware wording branch on
 * these declarative flags — never on a feature — so a new capability never needs
 * a new flag unless it introduces a genuinely new PRESENTATION need.
 */
export interface ChannelCapabilities {
	channel: ConversationChannel;
	/** Governs the few wording choices that vary by medium ("reply to this email" vs "reply here"). */
	medium: ChannelMedium;
	/** Rich/HTML rendering (email's design-system card). */
	supportsRichText: boolean;
	/** Native quick-reply buttons for `options` blocks (else a numbered list + prompt). */
	supportsInteractiveOptions: boolean;
	/** Tappable link buttons for `action` blocks (else a URL line). */
	supportsHyperlinkButtons: boolean;
	/** Hard per-message length limit (SMS segments); null = effectively unbounded. */
	maxTextLength: number | null;
	/** Whether the channel carries subjects (email) — drives job-title fallback. */
	hasSubjects: boolean;
	/** How a reply attaches to prior messages. */
	threadingModel: 'message-id' | 'session' | 'none';
	/** Real-time audio channel (voice) — turns are spoken and latency-bound. */
	isRealtimeVoice: boolean;
	supportsAttachments: boolean;
}

/** A customer turn, stripped of every provider/wire detail. */
export interface InboundAgentMessage {
	/**
	 * The contact's canonical address on this channel — a lower-cased email for
	 * `email`, an E.164 phone for whatsapp/sms/phone. Exactly what is stored as
	 * `AgentThread.contactAddress`.
	 */
	sender: { address: string; name: string };
	/** The customer's words, cleaned (reply-extracted for email, verbatim for chat). */
	text: string;
	/** Thread subject; '' for subjectless channels. */
	subject: string;
	/** Channel-native id of this inbound message ('' when unknown) — the dedup key. */
	externalMessageId: string;
}

/** Everything `deliver` needs besides the response — all feature-blind. */
export interface OutboundContext {
	account: Account;
	thread: AgentThread;
	to: { address: string; name: string };
	/** External id of the inbound message being answered ('' when none) — for threading. */
	replyToExternalId: string;
	/** The conversation subject to thread the reply under ('' for subjectless channels). */
	subject: string;
}

/** How a channel prefills the self-signup link for an unrecognized contact. */
export interface SignupPrefill {
	param: 'email' | 'phone';
	value: string;
}

/**
 * One channel = an identity space + one generic renderer + transport. Adapters
 * MUST NOT import `AgentDecision` or a capability's types — they see only
 * {@link AgentResponse} blocks. That is the structural guarantee that a new core
 * feature reaches every channel with zero adapter edits.
 */
export interface ChannelAdapter {
	readonly channel: ConversationChannel;
	readonly capabilities: ChannelCapabilities;
	/** Recognize the sender in this channel's identity space (email vs phone). */
	findCustomer(accountId: AccountId, contactAddress: string): Promise<Customer | null>;
	/** Which self-signup query param this channel prefills, and with what. */
	signupPrefill(sender: { address: string; name: string }): SignupPrefill;
	/**
	 * Generically render the neutral response for this channel and deliver it.
	 * Rejects on transport failure (the orchestrator rolls back side effects and
	 * rethrows so the provider redelivers). Resolves with the plain-text
	 * transcript line to record as the `rivus` turn — each channel's own text
	 * form, so email's transcript stays byte-for-byte what it was.
	 */
	deliver(response: AgentResponse, ctx: OutboundContext): Promise<string>;
}

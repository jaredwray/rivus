import type { AgentThread } from '@rivus/core';
import type { AppDeps } from '../../types';
import { type AgentEmail, NoopMailer } from '../email';
import type { SmsMessage, SmsSender } from '../sms';
import type { WhatsappMessage, WhatsappSender } from '../whatsapp';
import type { ChannelAdapter } from './channel';
import { createEmailChannelAdapter } from './email/adapter';
import { createSmsChannelAdapter } from './sms/adapter';
import { createWhatsappChannelAdapter } from './whatsapp/adapter';

/**
 * The staff Agent Tester's capture transports: the REAL channel adapters — same
 * identity space, same renderer — wired to a transport that records the outbound
 * instead of delivering it. Staff can therefore drive a channel end to end (the
 * orchestrator, the capabilities, the channel's own rendering, the thread state,
 * and the inbox transcript all run for real) while nothing ever reaches a
 * customer's inbox or phone.
 *
 * Everything here is per-request: {@link createTesterChannel} builds a fresh
 * adapter over a fresh capture buffer, so two staff sessions running at once can
 * never read each other's delivery.
 *
 * Like every channel module this one is decision-blind — it must never import
 * `engine.ts`, `capabilities.ts`, or `AgentDecision` (see AGENTS.md): it sees
 * only what the adapter it wraps sees.
 */

/** The channels the tester can drive — every channel with an outbound transport. */
export type TesterChannel = 'email' | 'sms' | 'whatsapp';

/** An agent thread the tester can drive; `phone` threads have no transport to capture. */
export type TesterThread = AgentThread & { channel: TesterChannel };

/** Whether a thread lives on a channel the tester can drive. */
export function isTesterThread(thread: AgentThread): thread is TesterThread {
	return thread.channel !== 'phone';
}

/** What the agent WOULD have delivered, captured instead of sent. */
export interface TesterDelivery {
	/** The plain text the contact would have received (the transcript line). */
	text: string;
	/** Email only: the rendered subject line. */
	subject?: string;
	/** Email only: the rendered HTML body, for previewing the real design-system card. */
	html?: string;
}

/** A per-request channel adapter plus the buffer its transport captures into. */
export interface TesterChannelHarness {
	/** The real adapter for the channel, with delivery redirected into `deliveries`. */
	readonly adapter: ChannelAdapter;
	/** Everything the transport intercepted during this request, in send order. */
	readonly deliveries: TesterDelivery[];
	/** The turn's outbound — an empty text when the turn sent nothing. */
	lastDelivery(): TesterDelivery;
}

/**
 * A mailer that captures the agent's reply. Everything else it inherits from
 * {@link NoopMailer} — the tester only ever exercises the agent's own send, and
 * the transactional emails have no place in a simulated customer turn.
 */
class CaptureMailer extends NoopMailer {
	constructor(private readonly deliveries: TesterDelivery[]) {
		super();
	}

	override async sendAgentEmail(email: AgentEmail): Promise<void> {
		// The real email renderer already ran, so the capture carries the exact
		// subject/HTML/text a customer would have received.
		this.deliveries.push({ text: email.text, subject: email.subject, html: email.html });
	}
}

/** An SMS sender that captures the message body instead of texting it. */
class CaptureSmsSender implements SmsSender {
	constructor(private readonly deliveries: TesterDelivery[]) {}

	async sendMessage(message: SmsMessage): Promise<void> {
		this.deliveries.push({ text: message.text });
	}
}

/** A WhatsApp sender that captures the message body instead of sending it. */
class CaptureWhatsappSender implements WhatsappSender {
	constructor(private readonly deliveries: TesterDelivery[]) {}

	async sendMessage(message: WhatsappMessage): Promise<void> {
		this.deliveries.push({ text: message.text });
	}
}

/**
 * Build the channel's real adapter over a capturing transport. Call it once per
 * request — the capture buffer is the instance's own, so concurrent testers stay
 * isolated.
 */
export function createTesterChannel(
	deps: Pick<AppDeps, 'config' | 'customers'>,
	channel: TesterChannel,
): TesterChannelHarness {
	const deliveries: TesterDelivery[] = [];
	return {
		adapter: buildAdapter(deps, channel, deliveries),
		deliveries,
		lastDelivery: () => deliveries.at(-1) ?? { text: '' },
	};
}

/** The real factory for each channel, given a capture transport. */
function buildAdapter(
	deps: Pick<AppDeps, 'config' | 'customers'>,
	channel: TesterChannel,
	deliveries: TesterDelivery[],
): ChannelAdapter {
	switch (channel) {
		case 'email':
			return createEmailChannelAdapter({
				config: deps.config,
				customers: deps.customers,
				mailer: new CaptureMailer(deliveries),
			});
		case 'sms':
			return createSmsChannelAdapter({
				customers: deps.customers,
				sender: new CaptureSmsSender(deliveries),
			});
		case 'whatsapp':
			return createWhatsappChannelAdapter({
				customers: deps.customers,
				sender: new CaptureWhatsappSender(deliveries),
			});
	}
}

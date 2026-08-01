import type { Account, Conversation, ConversationChannel, JobId, UserId } from '@rivus/core';
import type { FastifyBaseLogger } from 'fastify';
import { ConflictError } from '../../repositories/errors';
import type { AppDeps } from '../../types';
import { DELIVERY_FAILED_REASON } from '../inbox';
import type { AgentCapability, OrchestratorDeps, TurnContext } from './capabilities';
import type { ChannelAdapter, InboundAgentMessage, OutboundContext } from './channel';
import { buildCustomerSignupUrl } from './signup';
import { safeTimeZone } from './slots';
import { cleanSubject } from './subject';

/**
 * The single inbound flow every messaging channel runs — lifted verbatim from
 * the email route so a new channel reuses it wholesale. It owns everything
 * channel-agnostic (thread find/create with race recovery, dedup, transcript,
 * capability dispatch, side-effect execution with rollback-on-failed-send, and
 * the thread-state update) and delegates only the channel edges — identity,
 * rendering, transport — to the {@link ChannelAdapter}. Because feature behavior
 * lives entirely in the dispatched {@link AgentCapability}, a new capability runs
 * on every channel without either the orchestrator or any adapter changing.
 */

export interface InboundHandleResult {
	/** Whether the agent acted on the message (replied/booked) or ignored it. */
	handled: boolean;
	/** What the agent did (`offer_slots`, `book`, …) or why it ignored the message. */
	outcome: string;
}

export async function handleInboundAgentMessage(options: {
	deps: OrchestratorDeps;
	adapter: ChannelAdapter;
	capabilities: AgentCapability[];
	account: Account;
	message: InboundAgentMessage;
	logger: FastifyBaseLogger;
	/** The current instant — injected so orchestrator unit tests are deterministic. */
	now?: Date;
}): Promise<InboundHandleResult> {
	const { deps, adapter, capabilities, account, message } = options;
	const now = options.now ?? new Date();
	const channel = adapter.channel;
	const { conversations, agentThreads, config, jobs } = deps;

	const customer = await adapter.findCustomer(account.id, message.sender.address);
	// For a phone-shaped channel the contact's address *is* their phone, so record
	// it on the conversation when the CRM has none; email carries no phone here.
	const senderIsPhone = adapter.capabilities.medium !== 'email';
	const contactPhone = customer?.phone || (senderIsPhone ? message.sender.address : '');

	const openConversation = () =>
		conversations.create(account.id, {
			contactName: customer?.name || message.sender.name || message.sender.address,
			channel,
			customerId: customer?.id ?? '',
			contactPhone,
			status: 'rivus_handling',
			tags: [],
			lastInvoice: '',
		});

	// One thread per (account, channel, contact): find it or open it together with
	// the inbox conversation that carries the transcript.
	let thread = await agentThreads.findByContact(account.id, channel, message.sender.address);
	if (!thread) {
		const conversation = await openConversation();
		try {
			thread = await agentThreads.create({
				accountId: account.id,
				channel,
				contactAddress: message.sender.address,
				conversationId: conversation.id,
				customerId: customer?.id ?? '',
				subject: message.subject,
			});
		} catch (error) {
			if (!(error instanceof ConflictError)) {
				throw error;
			}
			// A concurrent delivery from the same brand-new contact won the create.
			// Drop the conversation this loser opened and continue on the winner's.
			await conversations.delete(account.id, conversation.id);
			thread = await agentThreads.findByContact(account.id, channel, message.sender.address);
			if (!thread) {
				throw error;
			}
		}
	} else if (
		message.externalMessageId !== '' &&
		thread.lastExternalMessageId === message.externalMessageId
	) {
		// At-least-once delivery: a message we already answered is a redelivery.
		return { handled: false, outcome: 'duplicate_delivery' };
	}

	// Record the customer's turn; recreate the conversation if the team deleted it.
	const transcriptBody = message.text || cleanSubject(message.subject) || '(empty message)';
	const appended = await conversations.addMessage(account.id, thread.conversationId, {
		author: 'customer',
		body: transcriptBody,
	});
	if (!appended) {
		const conversation = await openConversation();
		await conversations.addMessage(account.id, conversation.id, {
			author: 'customer',
			body: transcriptBody,
		});
		thread =
			(await agentThreads.update(account.id, thread.id, {
				conversationId: conversation.id,
			})) ?? thread;
	}

	// A sender who just self-signed-up gets linked to the thread/conversation.
	if (customer && thread.customerId === '') {
		await conversations.update(account.id, thread.conversationId, {
			customerId: customer.id,
			contactName: customer.name,
			...(customer.phone !== '' ? { contactPhone: customer.phone } : {}),
		});
	}

	const timeZone = safeTimeZone(account.timezone);
	const signupUrl = buildCustomerSignupUrl(
		config.WEBSITE_URL,
		account.slug,
		adapter.signupPrefill(message.sender),
	);
	const jobTitle = cleanSubject(message.subject) || cleanSubject(thread.subject) || 'Appointment';

	const ctx: TurnContext = {
		account,
		customer,
		thread,
		message,
		caps: adapter.capabilities,
		timeZone,
		now,
		signupUrl,
		jobTitle,
		deps,
	};
	// Dispatch to the first capability that claims the turn; the last always matches.
	const capability =
		capabilities.find((entry) => entry.matches(ctx)) ?? capabilities[capabilities.length - 1];
	if (!capability) {
		throw new Error('No agent capability is registered to handle the turn.');
	}
	const result = await capability.handle(ctx);

	// Execute declared side effects before delivering, so a delivery failure can
	// roll them back (an unconfirmed booking would otherwise block the redelivery).
	let bookedJobId = '';
	if (result.sideEffects?.bookJob) {
		const { note: _note, ...jobInput } = result.sideEffects.bookJob;
		const job = await jobs.create(account.id, jobInput);
		bookedJobId = job.id;
	}

	const outboundCtx: OutboundContext = {
		account,
		thread,
		to: { address: message.sender.address, name: customer?.name ?? message.sender.name },
		replyToExternalId: message.externalMessageId,
		subject: message.subject !== '' ? message.subject : thread.subject,
	};
	let transcriptLine: string;
	try {
		transcriptLine = await adapter.deliver(result.response, outboundCtx);
	} catch (error) {
		// The reply never reached the customer, so a just-created booking must not
		// stand: undo it and let the error surface (5xx → the provider redelivers,
		// and the thread state hasn't advanced, so the retry reprocesses cleanly).
		if (bookedJobId !== '') {
			await jobs.delete(account.id, bookedJobId as JobId).catch(() => false);
		}
		throw error;
	}

	await conversations.addMessage(account.id, thread.conversationId, {
		author: 'rivus',
		body: transcriptLine,
	});
	if (result.sideEffects?.bookJob) {
		await conversations.addMessage(account.id, thread.conversationId, {
			author: 'note',
			body: result.sideEffects.bookJob.note,
		});
	}
	// Handing the turn to a human happens only once the customer has actually been
	// told so. Re-reading the conversation (rather than trusting a copy from
	// earlier in the turn) is what makes the dedupe honest: a redelivered webhook
	// finds it already `needs_attention` and stops there instead of notifying the
	// whole team a second time.
	const flag = result.sideEffects?.flagForReview;
	if (flag) {
		const conversation = await conversations.findById(account.id, thread.conversationId);
		if (conversation) {
			await flagConversationForReview({
				deps,
				account,
				conversation,
				pendingReply: flag.pendingReply,
				flagReason: flag.flagReason,
				logger: options.logger,
			});
		}
	}

	await agentThreads.update(account.id, thread.id, {
		...result.threadPatch,
		...(bookedJobId !== '' ? { bookedJobId } : {}),
		customerId: customer?.id ?? thread.customerId,
		lastExternalMessageId: message.externalMessageId,
		subject: message.subject !== '' ? message.subject : thread.subject,
	});

	return { handled: true, outcome: result.outcome };
}

/**
 * Put one conversation in front of a human: flag it `needs_attention` with the
 * draft and reason, then alert every member. `needs_attention` IS the flag, so
 * an already-flagged conversation is left alone and nobody is notified twice —
 * that single guard is what makes both callers (a redelivered failure webhook,
 * a reprocessed inbound turn) idempotent. Returns whether it flagged.
 */
async function flagConversationForReview(options: {
	deps: Pick<AppDeps, 'conversations' | 'memberships' | 'notifier'>;
	account: Account;
	conversation: Conversation;
	/** The reply Rivus drafted but won't send ('' when it had none). */
	pendingReply: string;
	flagReason: string;
	logger: FastifyBaseLogger;
}): Promise<boolean> {
	const { deps, account, conversation, pendingReply, flagReason, logger } = options;
	if (conversation.status === 'needs_attention') {
		return false;
	}
	await deps.conversations.setReviewState(account.id, conversation.id, {
		status: 'needs_attention',
		pendingReply,
		flagReason,
	});
	// No human actor for a webhook — notify the whole team.
	const memberIds = (await deps.memberships.listByAccount(account.id)).map(
		(membership) => membership.userId,
	);
	await deps.notifier.conversationNeedsReview({
		accountId: account.id,
		actorId: '' as UserId,
		memberIds,
		contactName: conversation.contactName,
		logger,
	});
	return true;
}

/**
 * The channel-agnostic delivery-failure flow (a reply the agent sent bounced, was
 * marked spam, or was reported undeliverable): flag the thread's conversation
 * `needs_attention` with {@link DELIVERY_FAILED_REASON}, drop a channel-worded
 * inline note, and notify the team. Idempotent — an already-flagged conversation
 * no-ops. The caller resolves the account + contact from the provider event.
 */
export async function flagDeliveryFailure(options: {
	deps: Pick<AppDeps, 'conversations' | 'agentThreads' | 'memberships' | 'notifier'>;
	account: Account;
	channel: ConversationChannel;
	contactAddress: string;
	/** The inline note recorded for the team ("… bounced — follow up another way."). */
	noteBody: string;
	outcome: string;
	logger: FastifyBaseLogger;
}): Promise<InboundHandleResult> {
	const { deps, account, channel, contactAddress, noteBody, outcome, logger } = options;
	const thread = await deps.agentThreads.findByContact(account.id, channel, contactAddress);
	if (!thread) {
		return { handled: false, outcome: 'no_thread' };
	}
	const conversation = await deps.conversations.findById(account.id, thread.conversationId);
	if (!conversation) {
		return { handled: false, outcome: 'no_conversation' };
	}
	// `needs_attention` dedupes a redelivered webhook. It is no longer reached only
	// by a delivery failure — a capability can hand a turn to a human too — so an
	// already-flagged conversation is reported as such whatever flagged it, and the
	// note below is skipped rather than piling a second explanation onto the thread.
	if (conversation.status === 'needs_attention') {
		return { handled: false, outcome: 'already_flagged' };
	}
	await deps.conversations.addMessage(account.id, thread.conversationId, {
		author: 'note',
		body: noteBody,
	});
	await flagConversationForReview({
		deps,
		account,
		conversation,
		pendingReply: '',
		flagReason: DELIVERY_FAILED_REASON,
		logger,
	});
	return { handled: true, outcome };
}

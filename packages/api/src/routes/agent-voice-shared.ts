import type { Account } from '@rivus/core';
import type { FastifyBaseLogger } from 'fastify';
import type { AccountRepository, CustomerRepository } from '../repositories/types';
import type { AgentCapability, OrchestratorDeps } from '../services/agent/capabilities';
import { handleInboundAgentMessage } from '../services/agent/orchestrator';
import { createVoiceChannelAdapter } from '../services/agent/voice/adapter';

/**
 * The provider-agnostic core shared by the voice webhook routes (Plivo,
 * Twilio). Each provider route owns only its dialect — field names and the
 * XML it answers with (Plivo XML vs TwiML) — and hands normalized numbers and
 * transcribed speech here, so account resolution, the guards, the spoken
 * wording, and the turn policy can never drift between providers.
 */

/** Outcomes after which the call ends instead of listening for another turn. */
export const VOICE_TERMINAL_OUTCOMES = new Set([
	'book',
	'reschedule',
	'confirm_existing',
	'send_signup_link',
]);

export const VOICE_LINES = {
	goodbye: 'Thanks for calling. Goodbye!',
	noInput: "I didn't catch anything — call back anytime. Goodbye!",
	notInService: "Sorry, this number isn't in service. Goodbye!",
	anonymous:
		"Sorry, we can't take calls from restricted or anonymous numbers. Please call back with caller I D enabled. Goodbye!",
	// Spoken with HTTP 200 instead of erroring — deliberately. Voice webhooks are
	// call-flow requests, not async status callbacks: the response XML drives a
	// live call, so a non-200 buys no durable retry (a live caller can't be
	// parked while the service recovers); erroring would replace this polite
	// goodbye with the provider's generic mid-call failure handling. "Call back
	// in a few minutes" IS the retry path for a human on the phone.
	apology: 'Sorry, something went wrong on our end. Please call back in a few minutes. Goodbye!',
	reprompt: "Sorry, I didn't catch that. Could you say it again?",
} as const;

/** The greeting a connected caller hears — identical on every provider edge. */
export function voiceGreeting(accountName: string): string {
	return (
		`Hi! You've reached ${accountName}. I'm Rivus, their scheduling assistant. ` +
		'How can I help you today?'
	);
}

/** XML text escaping shared by both dialects (Plivo XML and TwiML). */
export function xmlEscape(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

/** Word numbers ASR may emit where the menu says "Option 1". */
const SPOKEN_NUMBERS: Record<string, string> = {
	one: '1',
	two: '2',
	three: '3',
	four: '4',
	five: '5',
	six: '6',
	seven: '7',
	eight: '8',
	nine: '9',
	ten: '10',
};

/**
 * Voice-edge speech normalization: "option one" → "option 1" (also "number
 * one"), so a spoken menu pick parses exactly like a typed one. Bare word
 * numbers ("two") already parse in core; this only covers the phrasing the
 * spoken menu itself invites.
 */
export function normalizeSpokenNumbers(text: string): string {
	return text
		.trim()
		.replace(
			/\b(option|number)\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b/gi,
			(_, lead: string, word: string) => `${lead} ${SPOKEN_NUMBERS[word.toLowerCase()]}`,
		);
}

/**
 * Resolve which account owns the called number, applying the same guards the
 * chat channels enforce — spoken, since a caller can't be answered with JSON.
 * Both numbers arrive already normalized to E.164 (or '') by the provider
 * route. Both repository implementations return null for '' lookups; the
 * explicit guards spare the lookups and keep the flow safe on its own terms.
 */
export async function resolveVoiceAccount(options: {
	accounts: AccountRepository;
	/** The called number, normalized ('' when unparseable). */
	businessNumber: string;
	/** The caller's number, normalized ('' for anonymous/restricted). */
	callerNumber: string;
}): Promise<Account | { speech: string }> {
	const { accounts, businessNumber, callerNumber } = options;
	if (businessNumber === '') {
		return { speech: VOICE_LINES.notInService };
	}
	const account = await accounts.findByChannelAddress('voice', businessNumber);
	if (!account || account.status === 'canceled') {
		return { speech: VOICE_LINES.notInService };
	}
	if (!account.channels.voice.enabled) {
		return { speech: `Sorry, ${account.name} isn't taking calls here right now. Goodbye!` };
	}
	// Loop guard: never converse with any account's own number.
	if (callerNumber !== '' && (await accounts.findByChannelAddress('voice', callerNumber))) {
		return { speech: VOICE_LINES.goodbye };
	}
	return account;
}

/** How the caller's turn resolved: keep listening, or speak and hang up. */
export interface VoiceTurnResult {
	mode: 'listen' | 'terminal';
	text: string;
}

/**
 * Run one spoken caller turn through the same channel-agnostic orchestrator
 * every other channel uses — thread state, inbox mirroring as a `phone`
 * conversation, booking — and decide the call flow from the outcome.
 */
export async function runVoiceTurn(options: {
	deps: OrchestratorDeps;
	customers: CustomerRepository;
	capabilities: AgentCapability[];
	account: Account;
	/** The caller's normalized E.164 number (non-empty — routes decline anonymous callers). */
	caller: string;
	/** The transcribed utterance, verbatim from the provider. */
	speech: string;
	logger: FastifyBaseLogger;
}): Promise<VoiceTurnResult> {
	const normalized = normalizeSpokenNumbers(options.speech);
	if (normalized === '') {
		return { mode: 'listen', text: VOICE_LINES.reprompt };
	}
	// The capture adapter hands back the rendered utterance to speak — voice is
	// the one channel whose transport is the webhook's own response.
	const capture = { text: '' };
	const adapter = createVoiceChannelAdapter({ customers: options.customers, capture });
	const result = await handleInboundAgentMessage({
		deps: options.deps,
		adapter,
		capabilities: options.capabilities,
		account: options.account,
		message: {
			sender: { address: options.caller, name: '' },
			text: normalized,
			subject: '',
			// Providers send no per-utterance id, and a synthetic call+speech key
			// would dedupe a caller legitimately repeating themselves into a goodbye
			// — worse than the rare timeout-retry replay it would catch, which lands
			// on the already-booked thread as confirm_existing. So '' (dedup off).
			externalMessageId: '',
		},
		logger: options.logger,
	});
	if (!result.handled || capture.text === '') {
		return { mode: 'terminal', text: VOICE_LINES.goodbye };
	}
	if (VOICE_TERMINAL_OUTCOMES.has(result.outcome)) {
		return { mode: 'terminal', text: `${capture.text} ${VOICE_LINES.goodbye}` };
	}
	return { mode: 'listen', text: capture.text };
}

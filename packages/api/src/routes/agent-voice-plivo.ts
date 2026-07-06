import { type Account, normalizePhone } from '@rivus/core';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponseSchema } from '../http-schemas';
import { defaultCapabilities } from '../services/agent/capabilities';
import { handleInboundAgentMessage } from '../services/agent/orchestrator';
import { createVoiceChannelAdapter } from '../services/agent/voice/adapter';
import { plivoFormBodyParser, plivoWebhookAuthHook, requestOrigin } from './plivo-webhook-auth';

/**
 * The Plivo edge of the scheduling agent's voice channel — the one channel
 * whose replies are SYNCHRONOUS: Plivo calls these webhooks and the call is
 * driven by the XML each response returns. A call arrives at the number's
 * `answer_url` (the answer route below), which greets the caller and listens
 * with `<GetInput inputType="speech">`; each transcribed utterance then POSTs
 * to the input route, which runs the same channel-agnostic orchestrator every
 * other channel uses — thread state, inbox mirroring (a `phone` conversation),
 * booking — and speaks the rendered reply back, looping the listen until the
 * conversation reaches a terminal outcome (booked, confirmed, or sent to
 * signup) and the call ends.
 *
 * v1 is turn-based (speak, listen, repeat) on the classic Voice API — a smart
 * receptionist cadence, not barge-in realtime speech. The channel plumbing
 * built here (provisioning, transcripts, guards) carries over unchanged if the
 * conversation loop later moves to Plivo Audio Streaming.
 */

/** The absolute path of the input webhook (`GetInput action`), under the app's mount. */
const INPUT_PATH = '/v1/channels/voice/plivo/input';

/** Outcomes after which the call ends instead of listening for another turn. */
const TERMINAL_OUTCOMES = new Set(['book', 'confirm_existing', 'send_signup_link']);

const GOODBYE = 'Thanks for calling. Goodbye!';
const NO_INPUT = "I didn't catch anything — call back anytime. Goodbye!";

function xmlEscape(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

/** A closing document: speak, then Plivo ends the call at the end of the XML. */
function speakDocument(text: string): string {
	return `<Response><Speak>${xmlEscape(text)}</Speak></Response>`;
}

/**
 * A listening document: speak the prompt, capture one spoken utterance to the
 * input route, and close politely if the caller says nothing. `hints` biases
 * recognition toward the option numbers the agent offers.
 */
function listenDocument(prompt: string, actionUrl: string): string {
	return (
		'<Response>' +
		`<GetInput action="${xmlEscape(actionUrl)}" method="POST" inputType="speech" language="en-US" hints="option,one,two,three,four,five,tomorrow,morning,afternoon">` +
		`<Speak>${xmlEscape(prompt)}</Speak>` +
		'</GetInput>' +
		`<Speak>${xmlEscape(NO_INPUT)}</Speak>` +
		'</Response>'
	);
}

// Plivo delivers numbers bare ("14155551234"); normalize like the other routes.
function callerNumber(value: string | undefined): string {
	const trimmed = (value ?? '').trim();
	if (trimmed === '') {
		return '';
	}
	return normalizePhone(trimmed.startsWith('+') ? trimmed : `+${trimmed}`);
}

// The call fields both webhooks carry (answer_method/GetInput both POST forms).
const callPayloadSchema = z.object({
	From: z.string().optional(),
	To: z.string().optional(),
	CallUUID: z.string().optional(),
	/** GetInput's transcription; absent on the answer webhook. */
	Speech: z.string().optional(),
});

export const agentVoicePlivoRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();
	const { config, accounts, customers, conversations, agentThreads, jobs } = app.deps;

	const capabilities = defaultCapabilities();

	app.addContentTypeParser(
		'application/x-www-form-urlencoded',
		{ parseAs: 'string' },
		plivoFormBodyParser,
	);
	// Same V2 signature gate as the other Plivo webhooks. No pinned URL: the two
	// voice endpoints have different paths, and nothing here doubles as a send-time
	// callback, so verification reconstructs each request's own URL.
	app.addHook('onRequest', plivoWebhookAuthHook(app, undefined));

	/**
	 * Resolve which account owns the called number, applying the same guards the
	 * chat channels enforce — spoken, since a caller can't be answered with JSON.
	 */
	async function resolveAccount(to: string, from: string): Promise<Account | { speech: string }> {
		const businessNumber = callerNumber(to);
		const account = await accounts.findByChannelAddress('voice', businessNumber);
		if (!account || account.status === 'canceled') {
			return { speech: "Sorry, this number isn't in service. Goodbye!" };
		}
		if (!account.channels.voice.enabled) {
			return { speech: `Sorry, ${account.name} isn't taking calls here right now. Goodbye!` };
		}
		// Loop guard: never converse with any account's own number.
		if (await accounts.findByChannelAddress('voice', callerNumber(from))) {
			return { speech: GOODBYE };
		}
		return account;
	}

	const voiceSchema = {
		tags: ['channels'],
		body: z.unknown(),
		response: { 200: z.string(), 401: errorResponseSchema, 503: errorResponseSchema },
	};

	app.post(
		'/voice/plivo/answer',
		{
			schema: {
				...voiceSchema,
				summary: 'Plivo voice webhook — answers an inbound call (answer_url)',
				description:
					'Plivo requests this URL when someone calls the account’s provisioned ' +
					'number (the application’s answer_url, answer_method POST). The response ' +
					'XML greets the caller and listens for speech; each utterance is ' +
					'transcribed and posted to the input webhook. Deliveries are ' +
					'authenticated with Plivo’s V2 signature headers when PLIVO_AUTH_TOKEN ' +
					'is configured.',
			},
		},
		async (request, reply) => {
			const payload = callPayloadSchema.safeParse(request.body);
			const { From = '', To = '' } = payload.success ? payload.data : {};
			const resolved = await resolveAccount(To, From);
			reply.type('text/xml');
			if (!('id' in resolved)) {
				return speakDocument(resolved.speech);
			}
			const greeting =
				`Hi! You've reached ${resolved.name}. I'm Rivus, their scheduling assistant. ` +
				'How can I help you today?';
			return listenDocument(greeting, `${requestOrigin(request)}${INPUT_PATH}`);
		},
	);

	app.post(
		'/voice/plivo/input',
		{
			schema: {
				...voiceSchema,
				summary: 'Plivo voice webhook — one transcribed caller utterance (GetInput action)',
				description:
					'GetInput posts each transcribed utterance here. The utterance runs ' +
					'through the same channel-agnostic scheduling orchestrator as every ' +
					'other channel (threads, inbox mirroring as a phone conversation, ' +
					'booking); the response XML speaks the agent’s reply and either listens ' +
					'for the next turn or ends the call on a terminal outcome.',
			},
		},
		async (request, reply) => {
			const payload = callPayloadSchema.safeParse(request.body);
			const {
				From = '',
				To = '',
				Speech = '',
				CallUUID = '',
			} = payload.success ? payload.data : {};
			const resolved = await resolveAccount(To, From);
			reply.type('text/xml');
			if (!('id' in resolved)) {
				return speakDocument(resolved.speech);
			}
			const actionUrl = `${requestOrigin(request)}${INPUT_PATH}`;
			const caller = callerNumber(From);
			if (caller === '') {
				return speakDocument(GOODBYE);
			}
			if (Speech.trim() === '') {
				return listenDocument("Sorry, I didn't catch that. Could you say it again?", actionUrl);
			}

			// One spoken turn = one orchestrated agent turn, same as a chat message.
			// The capture adapter hands back the rendered utterance to speak.
			const capture = { text: '' };
			const adapter = createVoiceChannelAdapter({ customers, capture });
			const result = await handleInboundAgentMessage({
				deps: { config, jobs, conversations, agentThreads },
				adapter,
				capabilities,
				account: resolved,
				message: {
					sender: { address: caller, name: '' },
					text: Speech,
					subject: '',
					// No per-utterance id from Plivo; '' skips redelivery dedup, which a
					// synchronous webhook doesn't need. CallUUID stays in the logs.
					externalMessageId: '',
				},
				logger: request.log.child({ callUuid: CallUUID }),
			});

			if (!result.handled || capture.text === '') {
				return speakDocument(GOODBYE);
			}
			if (TERMINAL_OUTCOMES.has(result.outcome)) {
				return speakDocument(`${capture.text} ${GOODBYE}`);
			}
			return listenDocument(capture.text, actionUrl);
		},
	);
};

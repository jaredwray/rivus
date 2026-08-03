import { normalizePhone } from '@rivus/core';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponseSchema } from '../http-schemas';
import { defaultCapabilities } from '../services/agent/capabilities';
import {
	resolveVoiceAccount,
	runVoiceTurn,
	VOICE_LINES,
	voiceGreeting,
	xmlEscape,
} from './agent-voice-shared';
import { plivoWebhookAuthHook } from './plivo-webhook-auth';
import { formUrlencodedParser, requestOrigin } from './webhook-http';

/**
 * The Plivo edge of the scheduling agent's voice channel. A call arrives at
 * the number's `answer_url` (the answer route), which greets the caller and
 * listens with `<GetInput inputType="speech">`; each transcribed utterance
 * POSTs to the input route. This route owns only the Plivo dialect — field
 * names and Plivo XML — and hands normalized numbers and speech to the shared
 * voice core (`./agent-voice-shared`), the same core the Twilio route uses.
 *
 * v1 is turn-based (speak, listen, repeat) — a smart receptionist cadence,
 * not barge-in realtime speech. The channel plumbing carries over unchanged
 * if the conversation loop later moves to audio streaming.
 */

/** The absolute path of the input webhook (`GetInput action`), under the app's mount. */
const INPUT_PATH = '/v1/channels/voice/plivo/input';

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
		`<Speak>${xmlEscape(VOICE_LINES.noInput)}</Speak>` +
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
	const {
		config,
		accounts,
		customers,
		conversations,
		agentThreads,
		jobs,
		faqs,
		faqAnswer,
		memberships,
		notifier,
	} = app.deps;

	const capabilities = defaultCapabilities();

	app.addContentTypeParser(
		'application/x-www-form-urlencoded',
		{ parseAs: 'string' },
		formUrlencodedParser,
	);
	// Same V2 signature gate as the other Plivo webhooks. No pinned URL: the two
	// voice endpoints have different paths, and nothing here doubles as a send-time
	// callback, so verification reconstructs each request's own URL.
	app.addHook('onRequest', plivoWebhookAuthHook(app, undefined));

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
			reply.type('text/xml');
			try {
				const payload = callPayloadSchema.safeParse(request.body);
				const { From = '', To = '' } = payload.success ? payload.data : {};
				const resolved = await resolveVoiceAccount({
					accounts,
					businessNumber: callerNumber(To),
					callerNumber: callerNumber(From),
				});
				if (!('id' in resolved)) {
					return speakDocument(resolved.speech);
				}
				// A caller with no presentable number can never be recognized or booked —
				// decline up front instead of greeting and hanging up a turn later.
				if (callerNumber(From) === '') {
					return speakDocument(VOICE_LINES.anonymous);
				}
				return listenDocument(
					voiceGreeting(resolved.name, resolved.agentName),
					`${requestOrigin(request)}${INPUT_PATH}`,
				);
			} catch (error) {
				request.log.error({ err: error }, 'voice answer webhook failed');
				return speakDocument(VOICE_LINES.apology);
			}
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
			reply.type('text/xml');
			try {
				const payload = callPayloadSchema.safeParse(request.body);
				const {
					From = '',
					To = '',
					Speech = '',
					CallUUID = '',
				} = payload.success ? payload.data : {};
				const resolved = await resolveVoiceAccount({
					accounts,
					businessNumber: callerNumber(To),
					callerNumber: callerNumber(From),
				});
				if (!('id' in resolved)) {
					return speakDocument(resolved.speech);
				}
				const caller = callerNumber(From);
				if (caller === '') {
					return speakDocument(VOICE_LINES.anonymous);
				}
				const turn = await runVoiceTurn({
					deps: {
						config,
						jobs,
						conversations,
						agentThreads,
						faqs,
						faqAnswer,
						memberships,
						notifier,
					},
					customers,
					capabilities,
					account: resolved,
					caller,
					speech: Speech,
					logger: request.log.child({ callUuid: CallUUID }),
				});
				if (turn.mode === 'terminal') {
					return speakDocument(turn.text);
				}
				return listenDocument(turn.text, `${requestOrigin(request)}${INPUT_PATH}`);
			} catch (error) {
				request.log.error({ err: error }, 'voice input webhook failed');
				return speakDocument(VOICE_LINES.apology);
			}
		},
	);
};

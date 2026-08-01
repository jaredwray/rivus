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
import { twilioWebhookAuthHook } from './twilio-webhook-auth';
import { formUrlencodedParser, requestOrigin } from './webhook-http';

/**
 * The Twilio edge of the scheduling agent's voice channel. A call arrives at
 * the number's VoiceUrl (the answer route — attached automatically when the
 * provisioner rents the number), which greets the caller and listens with
 * `<Gather input="speech">`; each transcribed utterance POSTs to the input
 * route. This route owns only the Twilio dialect — field names and TwiML —
 * and hands normalized numbers and speech to the shared voice core
 * (`./agent-voice-shared`), the same core the Plivo route uses.
 *
 * v1 is turn-based (speak, listen, repeat) — a smart receptionist cadence,
 * not barge-in realtime speech. The channel plumbing carries over unchanged
 * if the conversation loop later moves to audio streaming.
 */

/** The absolute path of the input webhook (`Gather action`), under the app's mount. */
const INPUT_PATH = '/v1/channels/voice/twilio/input';

const ANSWER_SUFFIX = '/answer';

/**
 * The input endpoint's public URL, derived from the pinned answer URL
 * (`TWILIO_VOICE_WEBHOOK_URL`, the VoiceUrl the provisioner attaches to rented
 * numbers) by swapping the final path segment. Twilio signs the exact URL it
 * requests, and for the input endpoint that is the `action` URL this route
 * itself hands out — deriving the action and the verification URL from the
 * same pin keeps them equal by construction. With no pin (or an unconventional
 * one) both fall back to per-request reconstruction, like the Plivo pair.
 */
function derivedInputUrl(answerUrl: string | undefined): string | undefined {
	if (!answerUrl?.endsWith(ANSWER_SUFFIX)) {
		return undefined;
	}
	return `${answerUrl.slice(0, -ANSWER_SUFFIX.length)}/input`;
}

/** A closing document: say, then Twilio ends the call at the end of the TwiML. */
function sayDocument(text: string): string {
	return `<Response><Say>${xmlEscape(text)}</Say></Response>`;
}

/**
 * A listening document: speak the prompt, gather one spoken utterance to the
 * input route, and close politely if the caller says nothing (an empty Gather
 * falls through to the next verb rather than requesting the action). `hints`
 * biases recognition toward the option numbers the agent offers;
 * `speechTimeout="auto"` ends the capture when the caller stops talking.
 */
function gatherDocument(prompt: string, actionUrl: string): string {
	return (
		'<Response>' +
		`<Gather input="speech" action="${xmlEscape(actionUrl)}" method="POST" language="en-US" speechTimeout="auto" hints="option,one,two,three,four,five,tomorrow,morning,afternoon">` +
		`<Say>${xmlEscape(prompt)}</Say>` +
		'</Gather>' +
		`<Say>${xmlEscape(VOICE_LINES.noInput)}</Say>` +
		'</Response>'
	);
}

// Twilio delivers numbers in E.164 (`+14155551234`) already; anonymous and
// restricted callers arrive as non-numeric markers, which normalize to ''.
function callerNumber(value: string | undefined): string {
	return normalizePhone((value ?? '').trim());
}

// The call fields both webhooks carry (VoiceUrl and Gather action both POST forms).
const callPayloadSchema = z.object({
	From: z.string().optional(),
	To: z.string().optional(),
	CallSid: z.string().optional(),
	/** Gather's transcription; absent on the answer webhook. */
	SpeechResult: z.string().optional(),
});

export const agentVoiceTwilioRoutes: FastifyPluginAsync = async (fastify) => {
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
	// Same X-Twilio-Signature gate as the messaging webhooks, but registered per
	// route: the two endpoints verify against different URLs (the answer route is
	// the number's VoiceUrl; the input route is the Gather action derived from it).
	const pinnedAnswerUrl = config.TWILIO_VOICE_WEBHOOK_URL;
	const pinnedInputUrl = derivedInputUrl(pinnedAnswerUrl);

	const voiceSchema = {
		tags: ['channels'],
		body: z.unknown(),
		response: { 200: z.string(), 401: errorResponseSchema, 503: errorResponseSchema },
	};

	app.post(
		'/voice/twilio/answer',
		{
			preValidation: twilioWebhookAuthHook(app, pinnedAnswerUrl),
			schema: {
				...voiceSchema,
				summary: 'Twilio voice webhook — answers an inbound call (VoiceUrl)',
				description:
					'Twilio requests this URL when someone calls the account’s provisioned ' +
					'number (the number’s VoiceUrl, attached at purchase). The response TwiML ' +
					'greets the caller and listens for speech; each utterance is transcribed ' +
					'and posted to the input webhook. Deliveries are authenticated with the ' +
					'X-Twilio-Signature header when TWILIO_AUTH_TOKEN is configured.',
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
					return sayDocument(resolved.speech);
				}
				// A caller with no presentable number can never be recognized or booked —
				// decline up front instead of greeting and hanging up a turn later.
				if (callerNumber(From) === '') {
					return sayDocument(VOICE_LINES.anonymous);
				}
				return gatherDocument(
					voiceGreeting(resolved.name),
					pinnedInputUrl ?? `${requestOrigin(request)}${INPUT_PATH}`,
				);
			} catch (error) {
				request.log.error({ err: error }, 'voice answer webhook failed');
				return sayDocument(VOICE_LINES.apology);
			}
		},
	);

	app.post(
		'/voice/twilio/input',
		{
			preValidation: twilioWebhookAuthHook(app, pinnedInputUrl),
			schema: {
				...voiceSchema,
				summary: 'Twilio voice webhook — one transcribed caller utterance (Gather action)',
				description:
					'Gather posts each transcribed utterance here. The utterance runs ' +
					'through the same channel-agnostic scheduling orchestrator as every ' +
					'other channel (threads, inbox mirroring as a phone conversation, ' +
					'booking); the response TwiML speaks the agent’s reply and either ' +
					'listens for the next turn or ends the call on a terminal outcome.',
			},
		},
		async (request, reply) => {
			reply.type('text/xml');
			try {
				const payload = callPayloadSchema.safeParse(request.body);
				const {
					From = '',
					To = '',
					SpeechResult = '',
					CallSid = '',
				} = payload.success ? payload.data : {};
				const resolved = await resolveVoiceAccount({
					accounts,
					businessNumber: callerNumber(To),
					callerNumber: callerNumber(From),
				});
				if (!('id' in resolved)) {
					return sayDocument(resolved.speech);
				}
				const caller = callerNumber(From);
				if (caller === '') {
					return sayDocument(VOICE_LINES.anonymous);
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
					speech: SpeechResult,
					logger: request.log.child({ callSid: CallSid }),
				});
				if (turn.mode === 'terminal') {
					return sayDocument(turn.text);
				}
				return gatherDocument(
					turn.text,
					pinnedInputUrl ?? `${requestOrigin(request)}${INPUT_PATH}`,
				);
			} catch (error) {
				request.log.error({ err: error }, 'voice input webhook failed');
				return sayDocument(VOICE_LINES.apology);
			}
		},
	);
};

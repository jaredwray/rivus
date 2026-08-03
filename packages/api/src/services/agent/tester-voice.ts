import { createOpenAI } from '@ai-sdk/openai';
import {
	experimental_generateSpeech as generateSpeech,
	NoTranscriptGeneratedError,
	type SpeechModel,
	type TranscriptionModel,
	experimental_transcribe as transcribe,
} from 'ai';
import type { Config } from '../../config';

/**
 * Speech for the development-only Agent Tester's simulated calls: what the
 * caller says, and what Rivus says back.
 *
 * A phone session is the one tester channel you can't really *read* — a call is
 * spoken, and the wording that works on a screen is not the wording that works
 * in an ear. So staff hold the call out loud: their utterance is transcribed and
 * fed to the same send path a typed one takes (the transcript is unchanged), and
 * the line the agent would speak is synthesized and played back.
 *
 * This is a tester nicety, never part of the real voice channel — Twilio and
 * Plivo do their own speech, and nothing here is on the path of a real call.
 * `OPENAI_API_KEY` is the switch: without it the routes report the feature
 * unconfigured and the app falls back to the browser's speech synthesis.
 */

/**
 * How the synthesized voice should sound. A real call's whole point is that the
 * caller can't tell it's software, so the instructions ask for the register a
 * good receptionist has — unhurried, warm, human — rather than the clipped
 * newsreader cadence a TTS model defaults to.
 */
const SPEECH_INSTRUCTIONS =
	'You are the friendly receptionist at a small local business, answering the phone. ' +
	'Speak warmly and naturally, at a relaxed conversational pace, the way a real person ' +
	'talks to a neighbor — not like a recording or an automated system. Let the sentences ' +
	'breathe, and keep the tone helpful and unhurried.';

/** The audio for one spoken line, in the shape the tester's routes hand to the app. */
export interface TesterSpeech {
	/** The audio bytes, base64-encoded so they can ride inside JSON. */
	audio: string;
	/** IANA media type of `audio` (OpenAI returns mp3, i.e. `audio/mpeg`). */
	mediaType: string;
}

export interface TesterVoiceService {
	/** Whether OpenAI speech is configured; false makes both methods unusable. */
	readonly enabled: boolean;
	/** Synthesize the line Rivus would speak on the call. */
	speak(text: string): Promise<TesterSpeech>;
	/**
	 * Transcribe one recorded utterance. Returns `''` when nothing was said —
	 * silence is a normal outcome of "tap, say nothing, tap", not a failure.
	 */
	transcribe(audio: Uint8Array): Promise<string>;
}

/**
 * The two AI calls this service makes, narrowed to what we use. Injectable so
 * tests can drive the mapping (and the empty-transcript path) without a model or
 * the network. Default to the AI SDK's own functions.
 */
export type SpeakFn = (options: {
	model: SpeechModel;
	text: string;
	voice?: string;
	instructions?: string;
}) => Promise<{ audio: { base64: string; mediaType: string } }>;

export type TranscribeFn = (options: {
	model: TranscriptionModel;
	audio: Uint8Array;
}) => Promise<{ text: string }>;

const defaultSpeak: SpeakFn = async (options) => {
	const { audio } = await generateSpeech(options);
	return { audio };
};

const defaultTranscribe: TranscribeFn = async (options) => {
	const { text } = await transcribe(options);
	return { text };
};

/** The media type to report when the provider doesn't name one; OpenAI sends mp3. */
const FALLBACK_MEDIA_TYPE = 'audio/mpeg';

/** OpenAI-backed speech for the tester's calls. */
export class OpenAiTesterVoiceService implements TesterVoiceService {
	readonly enabled = true;
	private readonly speechModel: SpeechModel;
	private readonly transcriptionModel: TranscriptionModel;
	private readonly voice: string;
	private readonly speakFn: SpeakFn;
	private readonly transcribeFn: TranscribeFn;

	constructor(options: {
		speechModel: SpeechModel;
		transcriptionModel: TranscriptionModel;
		voice: string;
		speak?: SpeakFn;
		transcribe?: TranscribeFn;
	}) {
		this.speechModel = options.speechModel;
		this.transcriptionModel = options.transcriptionModel;
		this.voice = options.voice;
		this.speakFn = options.speak ?? defaultSpeak;
		this.transcribeFn = options.transcribe ?? defaultTranscribe;
	}

	async speak(text: string): Promise<TesterSpeech> {
		const { audio } = await this.speakFn({
			model: this.speechModel,
			text,
			voice: this.voice,
			instructions: SPEECH_INSTRUCTIONS,
		});
		return { audio: audio.base64, mediaType: audio.mediaType || FALLBACK_MEDIA_TYPE };
	}

	async transcribe(audio: Uint8Array): Promise<string> {
		try {
			// The audio's container is sniffed from its magic bytes, so a Chrome
			// (webm/opus) and a Safari (mp4/aac) recording both go through as raw
			// bytes, with no media type to plumb through from the browser.
			const { text } = await this.transcribeFn({ model: this.transcriptionModel, audio });
			return text;
		} catch (error) {
			// A recording with no speech in it makes the provider return empty text,
			// which the SDK raises as an error. For a push-to-talk mic that's just the
			// caller saying nothing — an empty transcript, not a failed request.
			if (NoTranscriptGeneratedError.isInstance(error)) {
				return '';
			}
			throw error;
		}
	}
}

/**
 * The service when no OpenAI key is set. It answers `enabled: false` so the
 * routes can refuse before calling anything; the methods still throw, because
 * reaching them would mean a caller skipped that check.
 */
export class DisabledTesterVoiceService implements TesterVoiceService {
	readonly enabled = false;

	async speak(): Promise<TesterSpeech> {
		throw new Error('OpenAI voice is not configured');
	}

	async transcribe(): Promise<string> {
		throw new Error('OpenAI voice is not configured');
	}
}

/**
 * Build the tester's voice service from config: OpenAI when its key is set,
 * otherwise a disabled one. Speech is a single-provider feature — the tester
 * plays one voice and transcribes with the matching model, and no other
 * provider in the config offers both.
 */
export function createTesterVoiceService(
	config: Pick<
		Config,
		'OPENAI_API_KEY' | 'OPENAI_TTS_MODEL' | 'OPENAI_TTS_VOICE' | 'OPENAI_TRANSCRIBE_MODEL'
	>,
): TesterVoiceService {
	if (!config.OPENAI_API_KEY) {
		return new DisabledTesterVoiceService();
	}
	const openai = createOpenAI({ apiKey: config.OPENAI_API_KEY });
	return new OpenAiTesterVoiceService({
		speechModel: openai.speech(config.OPENAI_TTS_MODEL),
		transcriptionModel: openai.transcription(config.OPENAI_TRANSCRIBE_MODEL),
		voice: config.OPENAI_TTS_VOICE,
	});
}

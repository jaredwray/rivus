import { NoTranscriptGeneratedError, type SpeechModel, type TranscriptionModel } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config';
import {
	createTesterVoiceService,
	DisabledTesterVoiceService,
	OpenAiTesterVoiceService,
	type SpeakFn,
	type TranscribeFn,
} from '../src/services/agent/tester-voice';

// Placeholder models: the injected fns never look at them, so the tests can
// assert *which* model each call was handed without touching a provider.
const SPEECH_MODEL = 'speech-model' as unknown as SpeechModel;
const TRANSCRIPTION_MODEL = 'transcription-model' as unknown as TranscriptionModel;

function buildService(options: { speak?: SpeakFn; transcribe?: TranscribeFn } = {}) {
	return new OpenAiTesterVoiceService({
		speechModel: SPEECH_MODEL,
		transcriptionModel: TRANSCRIPTION_MODEL,
		voice: 'coral',
		speak: options.speak,
		transcribe: options.transcribe,
	});
}

describe('OpenAiTesterVoiceService.speak', () => {
	it('sends the line, the voice and the delivery instructions, and maps the audio back', async () => {
		const speak = vi.fn<SpeakFn>(async () => ({
			audio: { base64: 'QUJD', mediaType: 'audio/mpeg' },
		}));
		const service = buildService({ speak });

		const result = await service.speak('Thanks for calling Cascade Plumbing!');

		expect(result).toEqual({ audio: 'QUJD', mediaType: 'audio/mpeg' });
		const options = speak.mock.calls[0]?.[0];
		expect(options?.model).toBe(SPEECH_MODEL);
		expect(options?.text).toBe('Thanks for calling Cascade Plumbing!');
		expect(options?.voice).toBe('coral');
		// The whole point of the feature is that it doesn't sound like a robot, so
		// the delivery instructions must actually reach the provider.
		expect(options?.instructions).toContain('receptionist');
	});

	it('names a media type even when the provider leaves it blank', async () => {
		const service = buildService({
			speak: async () => ({ audio: { base64: 'QUJD', mediaType: '' } }),
		});
		// The browser plays the audio from a data URL, which is unplayable without a
		// type — so fall back to what OpenAI actually returns (mp3).
		expect(await service.speak('Hello?')).toEqual({ audio: 'QUJD', mediaType: 'audio/mpeg' });
	});

	it('lets a provider failure through to the route, which answers 502', async () => {
		const service = buildService({
			speak: async () => {
				throw new Error('speech provider is down');
			},
		});
		await expect(service.speak('Hello?')).rejects.toThrow('speech provider is down');
	});
});

describe('OpenAiTesterVoiceService.transcribe', () => {
	it('hands the recording to the transcription model and returns what was said', async () => {
		const transcribe = vi.fn<TranscribeFn>(async () => ({
			text: 'My water heater is leaking',
		}));
		const service = buildService({ transcribe });
		const audio = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);

		expect(await service.transcribe(audio)).toBe('My water heater is leaking');
		const options = transcribe.mock.calls[0]?.[0];
		expect(options?.model).toBe(TRANSCRIPTION_MODEL);
		// The bytes go through untouched — the transcriber reads the container from
		// them, so there is nothing to convert or declare on the way in.
		expect(options?.audio).toBe(audio);
	});

	it('reports silence as an empty transcript rather than an error', async () => {
		const service = buildService({
			transcribe: async () => {
				// What the SDK raises when the provider transcribes nothing at all —
				// which is exactly what a tap-tap with no words in between produces.
				throw new NoTranscriptGeneratedError({ responses: [] });
			},
		});
		expect(await service.transcribe(new Uint8Array([1, 2, 3]))).toBe('');
	});

	it('lets every other failure through to the route, which answers 502', async () => {
		const service = buildService({
			transcribe: async () => {
				throw new Error('transcription provider is down');
			},
		});
		await expect(service.transcribe(new Uint8Array([1, 2, 3]))).rejects.toThrow(
			'transcription provider is down',
		);
	});
});

describe('the AI SDK calls the service makes by default', () => {
	// A provider model standing in for OpenAI's: it answers `doGenerate` locally,
	// so the *real* SDK call — the one production takes — runs without a network.
	const now = new Date('2026-01-01T00:00:00.000Z');

	it('reads the audio and its media type off a generateSpeech result', async () => {
		const speechModel = {
			specificationVersion: 'v3',
			provider: 'fake',
			modelId: 'fake-tts',
			doGenerate: async () => ({
				// An MP3 frame header, which is what the SDK sniffs the type from.
				audio: new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00]),
				warnings: [],
				response: { timestamp: now, modelId: 'fake-tts', headers: {} },
			}),
		} as unknown as SpeechModel;
		const service = new OpenAiTesterVoiceService({
			speechModel,
			transcriptionModel: TRANSCRIPTION_MODEL,
			voice: 'coral',
		});

		const result = await service.speak('Hello?');

		expect(Buffer.from(result.audio, 'base64')).toHaveLength(6);
		expect(result.mediaType).toBe('audio/mpeg');
	});

	it('reads the words off a transcribe result', async () => {
		const transcriptionModel = {
			specificationVersion: 'v3',
			provider: 'fake',
			modelId: 'fake-stt',
			doGenerate: async () => ({
				text: 'Tuesday at nine works',
				segments: [],
				language: 'en',
				durationInSeconds: 2,
				warnings: [],
				response: { timestamp: now, modelId: 'fake-stt', headers: {} },
			}),
		} as unknown as TranscriptionModel;
		const service = new OpenAiTesterVoiceService({
			speechModel: SPEECH_MODEL,
			transcriptionModel,
			voice: 'coral',
		});

		expect(await service.transcribe(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]))).toBe(
			'Tuesday at nine works',
		);
	});
});

describe('DisabledTesterVoiceService', () => {
	it('reports itself unusable, and refuses both calls if one is attempted anyway', async () => {
		const service = new DisabledTesterVoiceService();
		expect(service.enabled).toBe(false);
		await expect(service.speak()).rejects.toThrow('OpenAI voice is not configured');
		await expect(service.transcribe()).rejects.toThrow('OpenAI voice is not configured');
	});
});

describe('createTesterVoiceService', () => {
	it('is disabled without an OpenAI key, so an unconfigured deployment still boots', () => {
		const config = loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
		expect(createTesterVoiceService(config).enabled).toBe(false);
	});

	it('builds the OpenAI-backed service once a key is set', () => {
		const config = loadConfig({
			NODE_ENV: 'test',
			OPENAI_API_KEY: 'sk-test',
		} as NodeJS.ProcessEnv);
		const service = createTesterVoiceService(config);
		expect(service.enabled).toBe(true);
		expect(service).toBeInstanceOf(OpenAiTesterVoiceService);
	});

	it('builds the configured models rather than the defaults', () => {
		const config = loadConfig({
			NODE_ENV: 'test',
			OPENAI_API_KEY: 'sk-test',
			OPENAI_TTS_MODEL: 'tts-1-hd',
			OPENAI_TRANSCRIBE_MODEL: 'whisper-1',
		} as NodeJS.ProcessEnv);
		// A model override that silently didn't take is the failure worth catching
		// here — the ids are only visible on the built models, so read them there.
		const service = createTesterVoiceService(config) as unknown as {
			speechModel: { modelId: string };
			transcriptionModel: { modelId: string };
		};
		expect(service.speechModel.modelId).toBe('tts-1-hd');
		expect(service.transcriptionModel.modelId).toBe('whisper-1');
	});

	it('defaults to the small, inexpensive speech models', () => {
		const config = loadConfig({
			NODE_ENV: 'test',
			OPENAI_API_KEY: 'sk-test',
		} as NodeJS.ProcessEnv);
		expect(config.OPENAI_TTS_MODEL).toBe('gpt-4o-mini-tts');
		expect(config.OPENAI_TTS_VOICE).toBe('coral');
		expect(config.OPENAI_TRANSCRIBE_MODEL).toBe('gpt-4o-mini-transcribe');
	});
});

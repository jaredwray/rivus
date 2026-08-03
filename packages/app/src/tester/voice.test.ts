import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	blobToBase64,
	canRecordAudio,
	IDLE_VOICE_STATE,
	pickRecorderMimeType,
	playTesterAudio,
	stopTesterAudio,
	unlockTesterAudio,
	type VoiceEvent,
	type VoiceState,
	voiceReducer,
} from './voice';

afterEach(() => {
	vi.unstubAllGlobals();
});

/** Run a script of events from idle, returning where the loop ends up. */
function play(...events: VoiceEvent[]): VoiceState {
	return events.reduce(voiceReducer, IDLE_VOICE_STATE);
}

describe('voiceReducer', () => {
	it('walks a whole spoken turn and re-opens the microphone on a call still listening', () => {
		const listening = play({ type: 'START' });
		expect(listening.phase).toBe('recording');
		expect(listening.hint).not.toBe('');

		const reading = voiceReducer(listening, { type: 'STOP_RECORDING' });
		expect(reading.phase).toBe('transcribing');

		const thinking = voiceReducer(reading, { type: 'TRANSCRIBED' });
		expect(thinking.phase).toBe('sending');

		const answering = voiceReducer(thinking, { type: 'TURN_OK', call: 'listen' });
		expect(answering.phase).toBe('speaking');

		// The call is still open, so the loop comes back round to listening.
		const again = voiceReducer(answering, { type: 'PLAYBACK_DONE' });
		expect(again.phase).toBe('recording');
		expect(again.error).toBe('');
	});

	it('leaves voice mode once the agent hangs up', () => {
		const state = play(
			{ type: 'START' },
			{ type: 'STOP_RECORDING' },
			{ type: 'TRANSCRIBED' },
			{ type: 'TURN_OK', call: 'ended' },
			{ type: 'PLAYBACK_DONE' },
		);
		expect(state).toEqual(IDLE_VOICE_STATE);
	});

	it('listens again with a nudge when the recording held no words', () => {
		const state = play(
			{ type: 'START' },
			{ type: 'STOP_RECORDING' },
			{ type: 'TRANSCRIBED_EMPTY' },
		);
		expect(state.phase).toBe('recording');
		expect(state.hint).toContain('Didn’t catch that');
		// Nothing went wrong — silence is an answer, not an error.
		expect(state.error).toBe('');
	});

	it('ends voice mode on a failure, keeping the reason for the screen', () => {
		const state = play(
			{ type: 'START' },
			{ type: 'STOP_RECORDING' },
			{ type: 'FAIL', message: 'Couldn’t play that reply out loud.' },
		);
		expect(state.phase).toBe('idle');
		expect(state.error).toBe('Couldn’t play that reply out loud.');
		expect(state.hint).toBe('');
	});

	it('exits from every phase of the loop', () => {
		const phases: VoiceEvent[][] = [
			[{ type: 'START' }],
			[{ type: 'START' }, { type: 'STOP_RECORDING' }],
			[{ type: 'START' }, { type: 'STOP_RECORDING' }, { type: 'TRANSCRIBED' }],
			[
				{ type: 'START' },
				{ type: 'STOP_RECORDING' },
				{ type: 'TRANSCRIBED' },
				{ type: 'TURN_OK', call: 'listen' },
			],
		];
		for (const script of phases) {
			expect(voiceReducer(play(...script), { type: 'EXIT' })).toEqual(IDLE_VOICE_STATE);
		}
	});

	it('ignores a completion that lands after the user left', () => {
		// A turn or a transcription can easily outlive the tap that started it; one
		// re-opening the microphone here would be a live mic nobody asked for.
		const left = play({ type: 'START' }, { type: 'STOP_RECORDING' }, { type: 'EXIT' });
		for (const event of [
			{ type: 'TRANSCRIBED' },
			{ type: 'TRANSCRIBED_EMPTY' },
			{ type: 'TURN_OK', call: 'listen' },
			{ type: 'PLAYBACK_DONE' },
		] satisfies VoiceEvent[]) {
			expect(voiceReducer(left, event)).toEqual(IDLE_VOICE_STATE);
		}
		// Only starting again brings it back.
		expect(voiceReducer(left, { type: 'START' }).phase).toBe('recording');
	});

	it('ignores a second "done talking" while the first is still being read', () => {
		const reading = play({ type: 'START' }, { type: 'STOP_RECORDING' });
		expect(voiceReducer(reading, { type: 'STOP_RECORDING' })).toBe(reading);
	});

	it('clears a stale error when the caller starts over', () => {
		const failed = play({ type: 'START' }, { type: 'FAIL', message: 'Microphone is blocked.' });
		expect(voiceReducer(failed, { type: 'START' }).error).toBe('');
	});
});

describe('canRecordAudio', () => {
	it('is true only where both a microphone and a recorder exist', () => {
		vi.stubGlobal('window', { MediaRecorder: function MediaRecorder() {} });
		vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => {} } });
		expect(canRecordAudio()).toBe(true);
	});

	it('is false without a recorder (an older browser, or a device)', () => {
		vi.stubGlobal('window', {});
		vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => {} } });
		expect(canRecordAudio()).toBe(false);
	});

	it('is false without microphone access (an insecure origin)', () => {
		vi.stubGlobal('window', { MediaRecorder: function MediaRecorder() {} });
		vi.stubGlobal('navigator', {});
		expect(canRecordAudio()).toBe(false);
	});
});

describe('pickRecorderMimeType', () => {
	/** A recorder that only claims to support the given containers. */
	function stubRecorder(supported: string[]): void {
		vi.stubGlobal('window', {
			MediaRecorder: Object.assign(function MediaRecorder() {}, {
				isTypeSupported: (type: string) => supported.includes(type),
			}),
		});
	}

	it('prefers Opus in WebM, what Chrome and Firefox record natively', () => {
		stubRecorder(['audio/webm;codecs=opus', 'audio/webm']);
		expect(pickRecorderMimeType()).toBe('audio/webm;codecs=opus');
	});

	it('falls back to plain WebM when the codec can’t be named', () => {
		stubRecorder(['audio/webm']);
		expect(pickRecorderMimeType()).toBe('audio/webm');
	});

	it('takes MP4, which is all Safari records', () => {
		stubRecorder(['audio/mp4']);
		expect(pickRecorderMimeType()).toBe('audio/mp4');
	});

	it('lets the browser choose when it supports none of them', () => {
		stubRecorder([]);
		expect(pickRecorderMimeType()).toBe('');
	});

	it('lets the browser choose when there is no recorder to ask', () => {
		vi.stubGlobal('window', {});
		expect(pickRecorderMimeType()).toBe('');
	});
});

describe('blobToBase64', () => {
	it('encodes a recording as the base64 the API takes', async () => {
		// The opening bytes of a WebM container, as a recording would start.
		const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
		const encoded = await blobToBase64(new Blob([bytes]));
		expect(encoded).toBe('GkXfow==');
		expect(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))).toEqual(bytes);
	});

	it('encodes an empty recording without inventing bytes', async () => {
		expect(await blobToBase64(new Blob([]))).toBe('');
	});

	it('survives a recording far larger than one chunk of encoding', async () => {
		// A minute of audio is hundreds of KB, so the encoder walks it in slices —
		// handing it all to String.fromCharCode at once would blow the argument list.
		const bytes = new Uint8Array(0x8000 * 2 + 5).fill(0x41);
		const encoded = await blobToBase64(new Blob([bytes]));
		expect(atob(encoded)).toHaveLength(bytes.length);
	});
});

/** A stand-in for the browser's audio element, driven by the test. */
class FakeAudio {
	static last: FakeAudio | null = null;
	src = '';
	currentTime = 0;
	paused = false;
	playCalls = 0;
	pauseCalls = 0;
	onended: (() => void) | null = null;
	onerror: (() => void) | null = null;
	/** When set, `play()` rejects the way a blocked autoplay does. */
	refusePlay = false;

	constructor() {
		FakeAudio.last = this;
	}

	play(): Promise<void> {
		this.playCalls += 1;
		return this.refusePlay ? Promise.reject(new Error('blocked')) : Promise.resolve();
	}

	pause(): void {
		this.paused = true;
		this.pauseCalls += 1;
	}
}

describe('playTesterAudio', () => {
	// The module keeps ONE audio element for the whole screen — that's what makes
	// a second reply stop the first — so the fake is created once and every case
	// drives the same instance, reset back to a resting state between them.
	let audio: FakeAudio;

	beforeEach(async () => {
		vi.stubGlobal('Audio', FakeAudio);
		const settling = playTesterAudio({ audio: '', mediaType: 'audio/mpeg' });
		audio = FakeAudio.last ?? audio;
		audio.onended?.();
		await settling;
		Object.assign(audio, { playCalls: 0, paused: false, currentTime: 0, refusePlay: false });
	});

	it('plays the line as a data URL and resolves when it finishes', async () => {
		const playing = playTesterAudio({ audio: 'QUJD', mediaType: 'audio/mpeg' });
		expect(audio.src).toBe('data:audio/mpeg;base64,QUJD');
		expect(audio.playCalls).toBe(1);

		audio.onended?.();
		await expect(playing).resolves.toBeUndefined();
	});

	it('stops the line already playing rather than layering a second one', async () => {
		const first = playTesterAudio({ audio: 'QUJD', mediaType: 'audio/mpeg' });
		const second = playTesterAudio({ audio: 'REVG', mediaType: 'audio/mpeg' });

		// The first caller is released rather than left waiting on audio that will
		// never finish, and the element is rewound for the new line.
		await expect(first).resolves.toBeUndefined();
		expect(audio.paused).toBe(true);
		expect(audio.src).toBe('data:audio/mpeg;base64,REVG');
		audio.onended?.();
		await expect(second).resolves.toBeUndefined();
	});

	it('rejects when the audio won’t play at all', async () => {
		const playing = playTesterAudio({ audio: 'QUJD', mediaType: 'audio/mpeg' });
		audio.onerror?.();
		await expect(playing).rejects.toThrow('wouldn’t play');
	});

	it('rejects when the browser refuses to start playback', async () => {
		// Autoplay policies reject playback that isn't traced to a gesture, and the
		// rejected promise is the only way the page hears about it.
		audio.refusePlay = true;
		await expect(playTesterAudio({ audio: 'QUJD', mediaType: 'audio/mpeg' })).rejects.toThrow(
			'wouldn’t play',
		);
	});

	it('releases a caller waiting on audio that gets stopped', async () => {
		const playing = playTesterAudio({ audio: 'QUJD', mediaType: 'audio/mpeg' });
		audio.currentTime = 12;
		stopTesterAudio();
		await expect(playing).resolves.toBeUndefined();
		expect(audio.paused).toBe(true);
		expect(audio.currentTime).toBe(0);
	});
});

describe('unlockTesterAudio', () => {
	let audio: FakeAudio;

	beforeEach(async () => {
		vi.stubGlobal('Audio', FakeAudio);
		// Settle whatever an earlier test left on the shared element, then zero the
		// counters so each case reads only its own activity.
		const settling = playTesterAudio({ audio: '', mediaType: 'audio/mpeg' });
		audio = FakeAudio.last as FakeAudio;
		audio.onended?.();
		await settling;
		Object.assign(audio, { playCalls: 0, pauseCalls: 0, paused: false, currentTime: 0 });
	});

	it('plays one silent sample on the tap and hands the element back paused', async () => {
		unlockTesterAudio();
		// The blessing has to come from a real (if inaudible) playback attempt.
		expect(audio.src.startsWith('data:audio/wav;base64,')).toBe(true);
		expect(audio.playCalls).toBe(1);

		await Promise.resolve();
		expect(audio.paused).toBe(true);
		expect(audio.currentTime).toBe(0);
	});

	it('leaves the element alone once a real line has taken it over', async () => {
		unlockTesterAudio();
		const playing = playTesterAudio({ audio: 'QUJD', mediaType: 'audio/mpeg' });
		// One pause — the takeover's own — and none after, or the unlock's cleanup
		// would be silencing the very reply it made possible.
		await Promise.resolve();
		expect(audio.src).toBe('data:audio/mpeg;base64,QUJD');
		expect(audio.pauseCalls).toBe(1);
		audio.onended?.();
		await expect(playing).resolves.toBeUndefined();
	});

	it('swallows a refusal — the reply path reports its own failures', async () => {
		audio.refusePlay = true;
		unlockTesterAudio();
		await Promise.resolve();
		expect(audio.pauseCalls).toBe(0);
	});
});

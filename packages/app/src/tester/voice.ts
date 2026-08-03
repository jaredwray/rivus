import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { RivusApiClient, TesterSpeech, TesterTurn } from '@/src/api/client';

/**
 * Holding a tester phone session out loud: the microphone, the playback, and the
 * little state machine that turns the two into a conversation.
 *
 * A call is spoken, and copy that reads well on a screen often lands badly in an
 * ear — so the tester lets staff *have* the call: tap, say something as the
 * caller, and hear the answer back. The turn itself is unchanged; this is only
 * an input and an output wrapped around the very same send path a typed message
 * takes, which is why the transcript comes out identical either way.
 *
 * Web only in practice, and the module says so by construction rather than by
 * checking a platform: everything here is a browser API that simply doesn't
 * exist on a device. Keeping it free of `react-native` is also what lets the
 * state machine be unit-tested under Node.
 */

/** How long one utterance may run before the recorder stops itself. */
export const MAX_UTTERANCE_MS = 60_000;

/** What the composer says while the microphone is open. */
const LISTENING_HINT = 'Listening — tap when you’re done talking.';
/** …and after a recording that turned out to hold no words. */
const NOTHING_HEARD_HINT = 'Didn’t catch that — say it again.';

/* ------------------------------ The call loop ----------------------------- */

/**
 * Where the spoken loop stands. Everything but `idle` means voice mode is on,
 * and each phase is one leg of a single turn: the caller speaks (`recording`),
 * is understood (`transcribing`), the agent thinks (`sending`), and answers
 * (`speaking`) — after which the loop re-arms the microphone, because a call
 * that's still open is a call still listening.
 */
export type VoicePhase = 'idle' | 'recording' | 'transcribing' | 'sending' | 'speaking';

export interface VoiceState {
	phase: VoicePhase;
	/** A quiet nudge for the composer; '' when there's nothing to say. */
	hint: string;
	/** Why voice mode stopped, for the screen's error line; '' when it didn't. */
	error: string;
	/** Where the last turn left the call — what `PLAYBACK_DONE` does next. */
	call: 'listen' | 'ended';
}

export type VoiceEvent =
	/** Enter voice mode (or arm a fresh utterance after one completed). */
	| { type: 'START' }
	/** The caller finished talking — the recording is on its way to be read. */
	| { type: 'STOP_RECORDING' }
	/** The recording held no words; the microphone re-arms rather than sending. */
	| { type: 'TRANSCRIBED_EMPTY' }
	| { type: 'TRANSCRIBED' }
	/** The turn ran; `call` is where it left the call. */
	| { type: 'TURN_OK'; call: 'listen' | 'ended' }
	| { type: 'PLAYBACK_DONE' }
	| { type: 'FAIL'; message: string }
	| { type: 'EXIT' };

/** Voice mode off: what the screen starts at, and what every exit returns to. */
export const IDLE_VOICE_STATE: VoiceState = {
	phase: 'idle',
	hint: '',
	error: '',
	call: 'listen',
};

/**
 * The call loop as a pure function, so its shape can be reasoned about (and
 * tested) without a microphone.
 *
 * Once idle, only `START` moves it again: a transcription or a turn that lands
 * after the user left voice mode must not quietly restart the microphone, and
 * dropping those events here means the browser side never has to remember
 * whether it's still wanted.
 */
export function voiceReducer(state: VoiceState, event: VoiceEvent): VoiceState {
	if (event.type === 'START') {
		return { phase: 'recording', hint: LISTENING_HINT, error: '', call: 'listen' };
	}
	if (state.phase === 'idle') {
		return state;
	}
	switch (event.type) {
		case 'STOP_RECORDING':
			// Only a recording can be finished; a second tap while the last one is
			// still being read is a slip, not an instruction.
			return state.phase === 'recording' ? { ...state, phase: 'transcribing', hint: '' } : state;
		case 'TRANSCRIBED_EMPTY':
			return { ...state, phase: 'recording', hint: NOTHING_HEARD_HINT };
		case 'TRANSCRIBED':
			return { ...state, phase: 'sending', hint: '' };
		case 'TURN_OK':
			return { ...state, phase: 'speaking', hint: '', call: event.call };
		case 'PLAYBACK_DONE':
			// The agent hung up, so voice mode has nothing left to listen for.
			return state.call === 'ended'
				? IDLE_VOICE_STATE
				: { ...state, phase: 'recording', hint: LISTENING_HINT };
		case 'FAIL':
			return { ...IDLE_VOICE_STATE, error: event.message };
		case 'EXIT':
			return IDLE_VOICE_STATE;
	}
}

/* --------------------------- Browser capabilities -------------------------- */

/**
 * Whether this platform can record the caller.
 *
 * Both halves have to be there — permission to reach a microphone, and a
 * recorder to capture it — and neither exists outside a browser, so the mic
 * affordance simply isn't offered where it wouldn't work (the same bargain
 * `canSpeakAloud` makes for playback).
 */
export function canRecordAudio(): boolean {
	return (
		typeof window !== 'undefined' &&
		typeof window.MediaRecorder === 'function' &&
		typeof navigator !== 'undefined' &&
		typeof navigator.mediaDevices?.getUserMedia === 'function'
	);
}

/**
 * Containers worth asking for, best first: Opus in WebM is what Chrome and
 * Firefox record natively, and MP4 (AAC) is Safari's only answer.
 */
const RECORDER_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

/**
 * The recording format to ask the browser for, or '' to let it choose.
 *
 * Nothing downstream cares which one wins: the API's transcriber reads the
 * container out of the bytes themselves, so this only has to name something the
 * browser will actually record — never something both ends agreed on.
 */
export function pickRecorderMimeType(): string {
	const recorder = typeof window === 'undefined' ? undefined : window.MediaRecorder;
	if (typeof recorder?.isTypeSupported !== 'function') {
		return '';
	}
	return RECORDER_MIME_TYPES.find((type) => recorder.isTypeSupported(type)) ?? '';
}

/**
 * A recording as the base64 the API takes.
 *
 * Deliberately built from `arrayBuffer()` rather than a `FileReader` data URL:
 * it's the same bytes with none of the callback ceremony, and it works anywhere
 * `Blob` does — including the Node runtime the tests run in.
 */
export async function blobToBase64(blob: Blob): Promise<string> {
	return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

/** Largest slice fed to `String.fromCharCode` at once (its argument list is bounded). */
const BASE64_CHUNK = 0x8000;

/** Base64 for raw bytes; `btoa` speaks characters, so hand it one byte per char. */
function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let index = 0; index < bytes.length; index += BASE64_CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(index, index + BASE64_CHUNK));
	}
	return btoa(binary);
}

/* -------------------------------- Playback -------------------------------- */

/**
 * One audio element for the whole screen, so a reply can never play over
 * another: starting a new line stops whatever is running, exactly as
 * `speakReply` cancels the browser's speech queue before speaking.
 */
let sharedAudio: HTMLAudioElement | null = null;
/** Settles the promise of whatever is playing, so stopping never strands a caller. */
let finishPlayback: (() => void) | null = null;

/** Stop whatever is playing and rewind it, ready to be re-used. */
export function stopTesterAudio(): void {
	if (sharedAudio) {
		sharedAudio.pause();
		sharedAudio.currentTime = 0;
	}
	finishPlayback?.();
}

/**
 * Play a synthesized line, resolving when it finishes (or when something else
 * stops it). The audio rides in as a data URL because that's the shape it
 * arrived in — base64 inside JSON — and it saves minting a blob URL per line.
 */
export function playTesterAudio(speech: TesterSpeech): Promise<void> {
	stopTesterAudio();
	if (sharedAudio === null) {
		sharedAudio = new Audio();
	}
	const audio = sharedAudio;
	return new Promise((resolve, reject) => {
		const settle = (finish: () => void) => {
			audio.onended = null;
			audio.onerror = null;
			finishPlayback = null;
			finish();
		};
		finishPlayback = () => settle(resolve);
		audio.onended = () => settle(resolve);
		audio.onerror = () => settle(() => reject(new Error('That reply wouldn’t play.')));
		audio.src = `data:${speech.mediaType};base64,${speech.audio}`;
		// Autoplay policies reject playback that isn't traced to a user gesture; the
		// rejection is the only way we'd hear about it, so it fails the same way an
		// unplayable file does.
		audio.play().catch(() => settle(() => reject(new Error('That reply wouldn’t play.'))));
	});
}

/* ------------------------------- The hook --------------------------------- */

/** The client calls voice mode makes; narrowed so tests can pass a stub. */
export type VoiceClient = Pick<RivusApiClient, 'speakTesterReply' | 'transcribeTesterAudio'>;

export interface VoiceCallOptions {
	/** Whether the API can serve speech at all — false keeps the hook dormant. */
	enabled: boolean;
	/** The session being held; changing it leaves voice mode. */
	sessionId: string | null;
	client: VoiceClient;
	token: string;
	/**
	 * The screen's own send path, so a spoken turn is byte-for-byte a typed one.
	 * Resolves with the turn, or null when the send failed — in which case voice
	 * mode ends quietly, since the screen already shows what went wrong.
	 */
	send: (text: string) => Promise<TesterTurn | null>;
}

export interface VoiceCall {
	state: VoiceState;
	/** Voice mode is running (any phase but idle). */
	active: boolean;
	/** Open the microphone — entering voice mode if it wasn't already on. */
	start: () => void;
	/** The caller is done talking: read the recording and run the turn. */
	stop: () => void;
	/** Leave voice mode, releasing the microphone. Safe to call at any time. */
	exit: () => void;
}

/**
 * Drive {@link voiceReducer} with a real microphone and a real speaker.
 *
 * Every asynchronous step re-checks the run it belongs to before touching
 * anything: a transcription or a turn can easily outlive the tap that started
 * it (the user switches session, or leaves voice mode), and a late completion
 * that re-opened the microphone would be a live mic nobody asked for.
 */
export function useVoiceCall(options: VoiceCallOptions): VoiceCall {
	const [state, dispatch] = useReducer(voiceReducer, IDLE_VOICE_STATE);
	// The latest props, read by the async steps: those outlive the render that
	// started them, and `send` in particular is rebuilt on nearly every one.
	const optionsRef = useRef(options);
	optionsRef.current = options;

	// A monotonic id for the current stretch of voice mode. Bumping it is how
	// leaving tells everything already in flight that it no longer speaks for us.
	const runRef = useRef(0);
	const streamRef = useRef<MediaStream | null>(null);
	const recorderRef = useRef<MediaRecorder | null>(null);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Finishing an utterance arms the next one, and arming one ends in finishing
	// it. A ref carries that loop without either callback depending on the other.
	const armRef = useRef<() => void>(() => {});

	/** Hand the microphone back: no recorder, no timer, no live tracks. */
	const releaseRecorder = useCallback(() => {
		if (timerRef.current !== null) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		const recorder = recorderRef.current;
		recorderRef.current = null;
		if (recorder) {
			// Detach first: a stop *we* asked for must not run the finish handler,
			// which would send an utterance the caller just abandoned.
			recorder.ondataavailable = null;
			recorder.onstop = null;
			if (recorder.state !== 'inactive') {
				recorder.stop();
			}
		}
		// Stopping every track is what turns the browser's recording indicator off;
		// keeping the stream between utterances would leave it lit for the whole call.
		for (const track of streamRef.current?.getTracks() ?? []) {
			track.stop();
		}
		streamRef.current = null;
	}, []);

	/** End voice mode, keeping `event`'s account of why. */
	const teardown = useCallback(
		(event: { type: 'EXIT' } | { type: 'FAIL'; message: string }) => {
			runRef.current += 1;
			releaseRecorder();
			stopTesterAudio();
			dispatch(event);
		},
		[releaseRecorder],
	);

	const exit = useCallback(() => teardown({ type: 'EXIT' }), [teardown]);

	/**
	 * The whole of one utterance: read it, run the turn it becomes, say the answer
	 * out loud, and hand the caller back the microphone if the call is still open.
	 */
	const finishUtterance = useCallback(
		async (blob: Blob, run: number) => {
			const { client, token, sessionId, send } = optionsRef.current;
			const current = () => runRef.current === run;
			if (!sessionId) {
				return;
			}
			let spoken: string;
			try {
				const audio = await blobToBase64(blob);
				const { text } = await client.transcribeTesterAudio(token, sessionId, { audio });
				if (!current()) {
					return;
				}
				spoken = text.trim();
			} catch (caught) {
				if (current()) {
					teardown({
						type: 'FAIL',
						message: messageFor(caught, 'Couldn’t make out that recording — try again.'),
					});
				}
				return;
			}
			if (spoken === '') {
				// Silence is an ordinary thing to record — a mis-tap, a pause held too
				// long. Say so and listen again rather than sending the agent nothing.
				dispatch({ type: 'TRANSCRIBED_EMPTY' });
				armRef.current();
				return;
			}
			dispatch({ type: 'TRANSCRIBED' });
			// The send path reports its own failures on screen, so anything but a turn
			// just steps voice mode aside rather than saying it twice.
			const turn = await send(spoken).catch(() => null);
			if (!current()) {
				return;
			}
			if (!turn) {
				exit();
				return;
			}
			// An absent `call` could only come from a channel with no call to keep
			// open, so read it as hung up rather than looping on the microphone.
			const call = turn.call ?? 'ended';
			dispatch({ type: 'TURN_OK', call });
			try {
				const speech = await client.speakTesterReply(token, sessionId, {
					text: turn.delivery.text,
				});
				if (!current()) {
					return;
				}
				await playTesterAudio(speech);
			} catch (caught) {
				// The turn itself succeeded and the transcript already shows it, so this
				// is only a failure to *hear* the reply — say that, and nothing worse.
				if (current()) {
					teardown({
						type: 'FAIL',
						message: messageFor(caught, 'Couldn’t play that reply out loud.'),
					});
				}
				return;
			}
			if (!current()) {
				return;
			}
			dispatch({ type: 'PLAYBACK_DONE' });
			if (call === 'listen') {
				armRef.current();
			}
		},
		[exit, teardown],
	);

	const stopRecording = useCallback(() => {
		dispatch({ type: 'STOP_RECORDING' });
		const recorder = recorderRef.current;
		if (recorder && recorder.state !== 'inactive') {
			// The recorder's own `onstop` carries on from here, with the audio assembled.
			recorder.stop();
		}
	}, []);

	/**
	 * Open the microphone for one utterance. Separate from {@link start} because
	 * re-arming mid-call is not re-entering voice mode: the loop is already in its
	 * `recording` phase by the time this runs.
	 */
	const arm = useCallback(() => {
		const run = runRef.current;
		if (!optionsRef.current.sessionId) {
			return;
		}
		void (async () => {
			let stream: MediaStream;
			try {
				stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			} catch {
				if (runRef.current === run) {
					// Denied, dismissed, no device — all the same thing to the person
					// holding the call, and none of the browser's wordings say it kindly.
					teardown({
						type: 'FAIL',
						message: 'Rivus needs microphone access to hear you — allow it and try again.',
					});
				}
				return;
			}
			if (runRef.current !== run) {
				// Voice mode ended while the permission prompt was up, so the stream we
				// were just granted is nobody's: give it straight back.
				for (const track of stream.getTracks()) {
					track.stop();
				}
				return;
			}
			streamRef.current = stream;
			const mimeType = pickRecorderMimeType();
			const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
			const chunks: Blob[] = [];
			recorder.ondataavailable = (event) => {
				if (event.data.size > 0) {
					chunks.push(event.data);
				}
			};
			recorder.onstop = () => {
				const recording = new Blob(chunks, { type: recorder.mimeType });
				releaseRecorder();
				void finishUtterance(recording, run);
			};
			recorderRef.current = recorder;
			recorder.start();
			// A recording nobody ends would grow until the API refuses it; cap it at a
			// length no single spoken turn needs.
			timerRef.current = setTimeout(() => {
				if (runRef.current === run) {
					stopRecording();
				}
			}, MAX_UTTERANCE_MS);
		})();
	}, [finishUtterance, releaseRecorder, stopRecording, teardown]);
	armRef.current = arm;

	const start = useCallback(() => {
		const { enabled, sessionId } = optionsRef.current;
		if (!enabled || !sessionId || !canRecordAudio()) {
			return;
		}
		// A fresh run, so anything still in flight from the last one is ignored.
		runRef.current += 1;
		releaseRecorder();
		stopTesterAudio();
		dispatch({ type: 'START' });
		arm();
	}, [arm, releaseRecorder]);

	// The microphone belongs to one session at a time. Entering this effect marks
	// the call this render may hold; leaving it — a switch to another session, the
	// server withdrawing voice, or the screen unmounting — hands the microphone
	// back rather than carrying the call over to something else.
	const { sessionId, enabled } = options;
	useEffect(() => {
		const held = enabled ? sessionId : null;
		return () => {
			if (held !== null) {
				exit();
			}
		};
	}, [sessionId, enabled, exit]);

	return {
		state,
		active: state.phase !== 'idle',
		start,
		stop: stopRecording,
		exit,
	};
}

/** The friendliest message an error carries, falling back to our own. */
function messageFor(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

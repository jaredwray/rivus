import type { Feather } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
	ActivityIndicator,
	Alert,
	Platform,
	Pressable,
	ScrollView,
	StyleSheet,
	TextInput,
	type TextInputKeyPressEvent,
	useWindowDimensions,
	View,
} from 'react-native';
import {
	ApiError,
	type Message,
	type TesterSession,
	type TesterSessionDetail,
	type TesterSpeech,
	type TesterTurn,
} from '@/src/api/client';
import { initialsOf, useAuth } from '@/src/auth/AuthContext';
import { BrandGradient } from '@/src/components/Gradient';
import {
	Avatar,
	Card,
	Dot,
	GradientButton,
	Icon,
	OutlineButton,
	Pill,
	RivusBadge,
	Txt,
} from '@/src/components/ui';
import { isSendKeyPress } from '@/src/tester/composer';
import { CHANNEL_META, STATE_META } from '@/src/tester/meta';
import { NewSessionModal } from '@/src/tester/NewSessionModal';
import {
	canRecordAudio,
	playTesterAudio,
	unlockTesterAudio,
	useVoiceCall,
	type VoiceCall,
} from '@/src/tester/voice';
import { colors, font, radii, SIDEBAR_BREAKPOINT } from '@/src/theme/tokens';
import { useDocumentTitle } from '@/src/theme/useDocumentTitle';

type FeatherName = ComponentProps<typeof Feather>['name'];

// Mobile Safari zooms the page when a focused input's font is under 16px, which
// shoves the send button off-screen — same guard RivusChat's composer uses.
const IS_WEB = Platform.OS === 'web';

/**
 * Where an async call started: the company it was made for, and the session it
 * belongs to (`null` for account-wide calls such as the list load). Engine turns
 * take seconds, so by the time one answers the user may have picked another
 * session — or switched company. A completion may only touch the conversation
 * pane while both are still what's on screen.
 */
type Origin = { accountId: string; sessionId: string | null };

/** Newest activity first, matching the order the API lists sessions in. */
function byActivity(a: TesterSession, b: TesterSession): number {
	return b.lastMessageAt.localeCompare(a.lastMessageAt);
}

function messageFor(error: unknown, fallback: string): string {
	if (error instanceof ApiError || error instanceof Error) {
		return error.message;
	}
	return fallback;
}

/** A short clock time for a transcript turn, matching the inbox's format. */
function clockTime(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) {
		return '';
	}
	return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Size of the identity mark beside a Rivus (or teammate) turn. */
const RIVUS_MARK = 26;

/** How long a preview's blob URL stays alive before it's revoked. */
const PREVIEW_URL_TTL_MS = 60_000;

/**
 * Tap slop for the quiet side-door buttons under a reply (preview the email,
 * play the reply): their ~16px rows sit far below the 44dp touch minimum
 * (WCAG 2.5.5), and everything the slop swallows — captions, the timestamp —
 * is text, not a competing target.
 */
const SIDE_DOOR_HIT_SLOP = { top: 14, bottom: 14, left: 14, right: 14 };

/**
 * Open the exact HTML body an email turn would have delivered, in a new tab.
 *
 * Web only: it needs a blob URL and a window, and the app carries no WebView
 * dependency to render one on device (the plain-text version is in the
 * transcript either way). The URL is revoked on a delay — revoking it straight
 * away can beat the new tab to loading it.
 *
 * The charset is spelled out because the rendered email doesn't carry a `<meta
 * charset>`: without it the tab falls back to a legacy encoding and every
 * non-ASCII character in the agent's copy (·, ’, —) renders as mojibake.
 */
function openEmailPreview(html: string): void {
	if (!IS_WEB || typeof window === 'undefined') {
		return;
	}
	const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
	window.open(url, '_blank', 'noopener');
	setTimeout(() => URL.revokeObjectURL(url), PREVIEW_URL_TTL_MS);
}

/**
 * Whether this platform can read a voice reply out loud *itself*.
 *
 * This is the fallback now: when the API has a speech provider the reply is
 * synthesized there, in a voice that sounds like a person. The browser's own
 * Web Speech API still answers for deployments without one — web only, since
 * the app carries no speech dependency, and hearing the line is a nicety on top
 * of reading it, so the button isn't offered where neither route works.
 */
function canSpeakAloud(): boolean {
	return IS_WEB && typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * Speak the line Rivus would have said on the call, in the browser's own voice.
 * Cancels whatever is already speaking first: pressing play twice means "say it
 * again from the top", not "queue a second reading behind the first".
 */
function speakReply(text: string): void {
	if (!canSpeakAloud()) {
		return;
	}
	window.speechSynthesis.cancel();
	window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

/**
 * Lines already synthesized, so replaying one — or hearing the same sign-off a
 * second time — costs nothing. Keyed by the line itself and capped, since a
 * long testing session would otherwise hold every reply of the day in memory.
 */
const SPEECH_CACHE_LIMIT = 20;
const speechCache = new Map<string, TesterSpeech>();

function rememberSpeech(text: string, speech: TesterSpeech): void {
	speechCache.set(text, speech);
	if (speechCache.size > SPEECH_CACHE_LIMIT) {
		const oldest = speechCache.keys().next().value;
		if (oldest !== undefined) {
			speechCache.delete(oldest);
		}
	}
}

/**
 * The staff-only Agent Tester: chat with the customer-facing scheduling agent
 * *as* a customer (or as an unknown contact) on any channel, hold several
 * parallel sessions, and delete one to reset the agent's state and start over.
 *
 * Every call runs the real agent pipeline server-side and hands back the reply
 * it *would* have delivered — nothing is actually sent. The routes exist only on
 * development deployments and only for Rivus staff, so the two gates the API
 * enforces (404 / 403) render here as explanations rather than errors.
 */
export default function AgentTesterScreen() {
	useDocumentTitle('Agent Tester');
	const { session, client, isStaff } = useAuth();
	const { width } = useWindowDimensions();
	const wide = width >= SIDEBAR_BREAKPOINT;
	// Key the loaders on the active company (and the credential), not on the whole
	// session object — that one is replaced whenever anything on it changes (a
	// profile edit, say), which would needlessly reload and drop the selection.
	// A staff "switch company" changes `accountId`, which *should* start over.
	const accountId = session?.account.id ?? '';
	// Empty on web, where the HttpOnly session cookie is the credential.
	const token = session?.token ?? '';

	const [sessions, setSessions] = useState<TesterSession[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<ApiError | Error | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const [modalOpen, setModalOpen] = useState(false);
	// Narrow layout only: the list and the conversation share the screen, so
	// picking a session slides the conversation in over it (as the inbox does).
	const [showConversation, setShowConversation] = useState(false);

	const [detail, setDetail] = useState<TesterSessionDetail | null>(null);
	const [detailLoading, setDetailLoading] = useState(false);
	const [detailError, setDetailError] = useState<string | null>(null);
	// The most recent turn's engine result, for the caption (and email preview)
	// under the last reply. Only a send produces one, so it clears whenever the
	// selection changes — and it is only ever installed for the session it came
	// from, so one session's outcome can't caption another's transcript.
	const [turn, setTurn] = useState<TesterTurn | null>(null);
	const [draft, setDraft] = useState('');
	// The customer turn we've optimistically appended while the engine runs, tagged
	// with the session it was typed into so it only paints under that header.
	const [pending, setPending] = useState<{ sessionId: string; text: string } | null>(null);
	// The session with a turn in flight, or null when idle. One turn at a time.
	const [sendingId, setSendingId] = useState<string | null>(null);
	const [sendError, setSendError] = useState<string | null>(null);
	// Whether the API can synthesize and transcribe speech, so a phone session can
	// be *held* rather than typed. Off until the API says otherwise — without it
	// the tester is exactly what it has always been.
	const [voiceEnabled, setVoiceEnabled] = useState(false);

	// The company and session the pane is showing *right now*, in refs so an async
	// call that started before a switch can compare against the live values when it
	// lands (the state captured in its closure is the stale, pre-switch one).
	const accountRef = useRef(accountId);
	const sessionRef = useRef<string | null>(null);
	useEffect(() => {
		accountRef.current = accountId;
	}, [accountId]);

	/** Whether a completion's origin is still what the conversation pane shows. */
	const isCurrent = useCallback(
		(origin: Origin) =>
			accountRef.current === origin.accountId &&
			(origin.sessionId === null || sessionRef.current === origin.sessionId),
		[],
	);

	const load = useCallback(
		async (isActive: () => boolean = () => true) => {
			// Non-staff get the explanation card below; don't fire a request the API
			// is only going to reject.
			if (!accountId || !isStaff) {
				setLoading(false);
				return;
			}
			// A manual refresh isn't tied to an effect's cleanup, so it carries its own
			// company: sessions fetched for one company must never list under another.
			const origin: Origin = { accountId, sessionId: null };
			const alive = () => isActive() && isCurrent(origin);
			setLoading(true);
			setLoadError(null);
			setActionError(null);
			try {
				const { data } = await client.listTesterSessions(token);
				if (alive()) {
					setSessions([...data].sort(byActivity));
				}
			} catch (caught) {
				if (alive()) {
					setSessions([]);
					setLoadError(caught instanceof Error ? caught : new Error('Could not load sessions.'));
				}
			} finally {
				if (alive()) {
					setLoading(false);
				}
			}
		},
		[client, token, accountId, isStaff, isCurrent],
	);

	// Ask once per company whether calls can be spoken here. A failure is silent
	// on purpose: every other answer (no key, no route, an old API) means the
	// tester works exactly as it did before, which is not worth an error card.
	useEffect(() => {
		if (!accountId || !isStaff) {
			return;
		}
		let active = true;
		client
			.getTesterVoice(token)
			.then((result) => {
				if (active) {
					setVoiceEnabled(result.enabled);
				}
			})
			.catch(() => {
				if (active) {
					setVoiceEnabled(false);
				}
			});
		return () => {
			active = false;
		};
	}, [client, token, accountId, isStaff]);

	// `load` is re-created whenever the active company is, so this both loads on
	// mount and starts the next company clean — one company's sessions, selection
	// or transcript must never show under another's name.
	useEffect(() => {
		let active = true;
		setSessions([]);
		setSelectedId(null);
		setDetail(null);
		setTurn(null);
		setPending(null);
		setSendError(null);
		setDraft('');
		setShowConversation(false);
		void load(() => active);
		return () => {
			active = false;
		};
	}, [load]);

	const loadDetail = useCallback(
		async (id: string, isActive: () => boolean = () => true) => {
			if (!accountId) {
				return;
			}
			const origin: Origin = { accountId, sessionId: id };
			const alive = () => isActive() && isCurrent(origin);
			// Clear the previous transcript up front so one session's turns never show
			// under another's header while the new one loads.
			setDetail(null);
			setTurn(null);
			setDetailError(null);
			setSendError(null);
			setPending(null);
			setDraft('');
			setDetailLoading(true);
			try {
				const result = await client.getTesterSession(token, id);
				if (alive()) {
					setDetail(result);
				}
			} catch (caught) {
				if (alive()) {
					setDetail(null);
					setDetailError(messageFor(caught, 'Could not load this session.'));
				}
			} finally {
				if (alive()) {
					setDetailLoading(false);
				}
			}
		},
		[client, token, accountId, isCurrent],
	);

	// Whatever the user last picked, falling back to the top of the list.
	const selected = sessions.find((item) => item.id === selectedId) ?? sessions[0] ?? null;
	// Re-load only when the selected *id* changes — not when a turn replaces the
	// session object in the list, which would refetch on every send.
	const selectedKey = selected?.id ?? null;
	// Kept in a ref as well: async completions read it to decide whether their
	// session is still the one on screen (see `isCurrent`).
	useEffect(() => {
		sessionRef.current = selectedKey;
	}, [selectedKey]);
	useEffect(() => {
		if (!selectedKey) {
			setDetail(null);
			setTurn(null);
			return;
		}
		let active = true;
		void loadDetail(selectedKey, () => active);
		return () => {
			active = false;
		};
	}, [selectedKey, loadDetail]);

	/**
	 * Run one turn as the impersonated customer. Typed and spoken messages both
	 * come through here, so a call held out loud paints the same optimistic
	 * bubble, the same thinking spinner and the same transcript a typed one does —
	 * the spoken words are only another way of filling in the text.
	 *
	 * Resolves with the turn, or null when it failed (the error line explains).
	 */
	const sendText = useCallback(
		async (text: string): Promise<TesterTurn | null> => {
			if (!selected) {
				return null;
			}
			const origin: Origin = { accountId, sessionId: selected.id };
			setSendingId(selected.id);
			setSendError(null);
			setDraft('');
			setPending({ sessionId: selected.id, text });
			try {
				const result = await client.sendTesterMessage(token, selected.id, { text });
				// The turn really happened, so its row is refreshed whatever the user is
				// looking at now — state, snippet and place in the order all moved on.
				if (accountRef.current === origin.accountId) {
					setSessions((prev) =>
						prev
							.map((item) => (item.id === result.session.id ? result.session : item))
							.sort(byActivity),
					);
				}
				// The transcript and the engine's outcome, though, belong to *this* session:
				// install them only while it's still the one the pane is showing.
				if (isCurrent(origin)) {
					setTurn(result);
					setDetail({ session: result.session, messages: result.messages });
				}
				return result;
			} catch (caught) {
				if (isCurrent(origin)) {
					// Put the text back in the composer so the turn can be retried as typed.
					setDraft(text);
					setSendError(messageFor(caught, 'Could not run that turn.'));
				}
				return null;
			} finally {
				// Only one turn runs at a time, so this can't clear another's bubble.
				setPending(null);
				setSendingId(null);
			}
		},
		[token, selected, client, accountId, isCurrent],
	);

	// A call can be spoken only where every part of the chain is there: the API
	// has a speech provider, the platform has a microphone, and the session is a
	// phone one — the other channels are written, not said.
	const canHoldCall = voiceEnabled && IS_WEB && canRecordAudio();
	const callSessionId = selected?.channel === 'phone' ? selected.id : null;
	const voice = useVoiceCall({
		enabled: canHoldCall,
		sessionId: callSessionId,
		client,
		token,
		send: sendText,
	});
	const voiceExit = voice.exit;

	const onSend = useCallback(async () => {
		const text = draft.trim();
		if (!selected || text === '' || sendingId !== null) {
			return;
		}
		// Typing takes the turn back from the microphone — one at a time, and the
		// caller has clearly stopped speaking.
		voiceExit();
		await sendText(text);
	}, [draft, selected, sendingId, sendText, voiceExit]);

	/**
	 * Play a line of the agent's reply. Prefers the API's own voice — the point of
	 * the feature is that it doesn't sound like a machine — and falls back to the
	 * browser's speech synthesis whenever that isn't available or doesn't answer,
	 * so the button always does something.
	 */
	const playSessionId = selected?.id ?? '';
	const playReply = useCallback(
		async (text: string) => {
			// Still inside the press that asked for this — the one moment playback
			// rights can be earned before the synthesis round-trip (Safari refuses a
			// `play()` that arrives with no gesture behind it).
			unlockTesterAudio();
			if (voiceEnabled && playSessionId) {
				try {
					const cached = speechCache.get(text);
					const speech = cached ?? (await client.speakTesterReply(token, playSessionId, { text }));
					if (!cached) {
						rememberSpeech(text, speech);
					}
					// Not awaited: the caller only waits for the audio to arrive, so the
					// button stops spinning when the line starts rather than when it ends.
					void playTesterAudio(speech).catch(() => speakReply(text));
					return;
				} catch {
					// Nothing to explain here — the browser's own voice reads it instead.
				}
			}
			speakReply(text);
		},
		[client, token, voiceEnabled, playSessionId],
	);

	const performDelete = useCallback(
		async (target: TesterSession) => {
			if (deletingId) {
				return;
			}
			const origin: Origin = { accountId, sessionId: target.id };
			setActionError(null);
			setDeletingId(target.id);
			try {
				await client.deleteTesterSession(token, target.id);
				// After a company switch the list holds another company's sessions
				// entirely — dropping a row from it (or clearing its pane) is not ours.
				if (accountRef.current === origin.accountId) {
					setSessions((prev) => prev.filter((item) => item.id !== target.id));
					if (isCurrent(origin)) {
						setSelectedId(null);
						setDetail(null);
						setTurn(null);
						setShowConversation(false);
					}
				}
			} catch (caught) {
				if (accountRef.current === origin.accountId) {
					setActionError(messageFor(caught, 'Could not delete that session.'));
				}
			} finally {
				setDeletingId(null);
			}
		},
		[client, token, deletingId, accountId, isCurrent],
	);

	/**
	 * Deleting resets the agent's state for that contact, so confirm first — a
	 * native alert on device, the browser's confirm on web (RN's `Alert` is a
	 * no-op under react-native-web), exactly as the schedule screen does.
	 */
	const confirmDelete = useCallback(
		(target: TesterSession) => {
			const who = target.contactName || target.contactAddress;
			const message = `Delete the session with ${who}? This resets the agent's state for that contact.`;
			if (Platform.OS === 'web') {
				if (typeof window !== 'undefined' && window.confirm(message)) {
					void performDelete(target);
				}
				return;
			}
			Alert.alert('Delete session', message, [
				{ text: 'Cancel', style: 'cancel' },
				{ text: 'Delete', style: 'destructive', onPress: () => void performDelete(target) },
			]);
		},
		[performDelete],
	);

	const onCreated = useCallback((created: TesterSession) => {
		setSessions((prev) =>
			[created, ...prev.filter((item) => item.id !== created.id)].sort(byActivity),
		);
		setSelectedId(created.id);
		setShowConversation(true);
		setModalOpen(false);
	}, []);

	if (!session) {
		return null;
	}

	const header = (
		<View style={styles.head}>
			<Txt style={styles.title}>Agent Tester</Txt>
			<Txt style={styles.subtitle}>
				Chat with the Rivus agent as one of your customers. Messages run the real engine — nothing
				is delivered. Development only.
			</Txt>
		</View>
	);

	// The API gates these routes twice (staff, and development deployments only).
	// Explain each rather than showing a bare failure — neither is a bug.
	const status = loadError instanceof ApiError ? loadError.status : null;
	if (!isStaff || status === 403) {
		return (
			<Notice
				header={header}
				icon="lock"
				title="Rivus staff only"
				body="This tool is for Rivus staff."
			/>
		);
	}
	if (status === 404) {
		return (
			<Notice
				header={header}
				icon="tool"
				title="Development only"
				body="The agent tester is only available on development environments."
			/>
		);
	}
	if (loadError) {
		return (
			<Notice
				header={header}
				icon="alert-circle"
				title="Couldn’t load the tester"
				body={loadError.message}
				onRetry={() => void load()}
			/>
		);
	}

	const listPane = (
		<SessionList
			sessions={sessions}
			selectedId={selected?.id ?? null}
			loading={loading}
			deletingId={deletingId}
			error={actionError}
			full={!wide}
			onPick={(id) => {
				setSelectedId(id);
				if (!wide) {
					setShowConversation(true);
				}
			}}
			onNew={() => setModalOpen(true)}
			onRefresh={() => void load()}
			onDelete={confirmDelete}
		/>
	);

	// Everything the pane paints is scoped to the session on screen: a turn still
	// running for another session must not show its bubble or spinner here.
	const activeId = selected?.id ?? null;
	const pendingText = pending !== null && pending.sessionId === activeId ? pending.text : null;

	const conversationPane = (
		<Conversation
			session={selected}
			detail={detail}
			turn={turn}
			loading={detailLoading}
			error={detailError}
			sendError={sendError}
			pending={pendingText}
			sending={sendingId !== null && sendingId === activeId}
			busy={sendingId !== null}
			draft={draft}
			deleting={selected !== null && deletingId === selected.id}
			// The microphone belongs to the phone session on screen, and only where
			// the whole chain holds up; everywhere else the composer is unchanged.
			voice={canHoldCall && callSessionId !== null ? voice : null}
			// Either voice can read a reply, so the side door opens for both — but
			// both play in a browser, which is the one thing they have in common.
			canPlayReply={canSpeakAloud() || (IS_WEB && voiceEnabled)}
			// While a call is being held, a replay would talk over the live
			// microphone — or stop the reply mid-line and re-arm it early. On a
			// call, the call has the floor.
			replayInert={voice.active}
			onPlayReply={playReply}
			// Leaving for the session list hides every voice control, so it also
			// hangs up voice mode — a live microphone must never outlast its UI.
			onBack={
				wide
					? undefined
					: () => {
							voiceExit();
							setShowConversation(false);
						}
			}
			onChangeDraft={setDraft}
			onSend={() => void onSend()}
			onDelete={confirmDelete}
		/>
	);

	const modal = (
		<NewSessionModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={onCreated} />
	);

	if (wide) {
		return (
			<View style={styles.root}>
				{header}
				<View style={styles.row}>
					{listPane}
					{conversationPane}
				</View>
				{modal}
			</View>
		);
	}

	return (
		<View style={styles.root}>
			{showConversation && selected ? (
				conversationPane
			) : (
				<>
					{header}
					{listPane}
				</>
			)}
			{modal}
		</View>
	);
}

/* --------------------------------- Notices -------------------------------- */

/** A full-pane explanation card (staff-only, development-only, load failure). */
function Notice({
	header,
	icon,
	title,
	body,
	onRetry,
}: {
	header: ReactNode;
	icon: FeatherName;
	title: string;
	body: string;
	onRetry?: () => void;
}) {
	return (
		<View style={styles.root}>
			{header}
			<ScrollView contentContainerStyle={styles.noticeWrap}>
				<Card style={styles.notice}>
					<View style={styles.noticeIcon}>
						<Icon name={icon} size={20} color={colors.textMuted} />
					</View>
					<Txt style={styles.noticeTitle}>{title}</Txt>
					<Txt style={styles.noticeBody}>{body}</Txt>
					{onRetry ? <OutlineButton label="Try again" icon="refresh-cw" onPress={onRetry} /> : null}
				</Card>
			</ScrollView>
		</View>
	);
}

/* ------------------------------- Session list ----------------------------- */

function SessionList({
	sessions,
	selectedId,
	loading,
	deletingId,
	error,
	full,
	onPick,
	onNew,
	onRefresh,
	onDelete,
}: {
	sessions: TesterSession[];
	selectedId: string | null;
	loading: boolean;
	deletingId: string | null;
	error: string | null;
	full?: boolean;
	onPick: (id: string) => void;
	onNew: () => void;
	onRefresh: () => void;
	onDelete: (session: TesterSession) => void;
}) {
	return (
		<View style={[styles.list, full && styles.listFull]}>
			<View style={styles.listHead}>
				<View style={styles.listHeadTop}>
					<Txt style={styles.listTitle}>Sessions</Txt>
					<Pressable
						onPress={onRefresh}
						disabled={loading}
						accessibilityRole="button"
						accessibilityLabel="Refresh sessions"
						hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
						style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
					>
						<Icon name="refresh-cw" size={15} color={colors.textMuted} />
					</Pressable>
				</View>
				<GradientButton label="New session" icon="plus" onPress={onNew} />
			</View>

			{error ? <Txt style={styles.listError}>{error}</Txt> : null}

			{loading ? (
				<ActivityIndicator color={colors.brandPurple} style={styles.listLoading} />
			) : sessions.length === 0 ? (
				<View style={styles.emptyWrap}>
					<Card style={styles.empty}>
						<Txt style={styles.emptyTitle}>No sessions yet</Txt>
						<Txt style={styles.emptyBody}>
							Start one to write to the agent as a customer and watch how it answers.
						</Txt>
						<GradientButton label="New session" icon="plus" onPress={onNew} />
					</Card>
				</View>
			) : (
				<ScrollView contentContainerStyle={styles.listScroll}>
					{sessions.map((item) => (
						<SessionRow
							key={item.id}
							session={item}
							active={item.id === selectedId}
							deleting={deletingId === item.id}
							onPick={() => onPick(item.id)}
							onDelete={() => onDelete(item)}
						/>
					))}
				</ScrollView>
			)}
		</View>
	);
}

function SessionRow({
	session,
	active,
	deleting,
	onPick,
	onDelete,
}: {
	session: TesterSession;
	active: boolean;
	deleting: boolean;
	onPick: () => void;
	onDelete: () => void;
}) {
	const contactLabel = session.contactName || session.contactAddress;
	return (
		// The trash is a SIBLING overlaid on the row, not a child of it: on web both
		// pressables render as real <button>s, and a button inside a button is
		// invalid DOM (and would fire both presses).
		<View>
			<Pressable
				onPress={onPick}
				accessibilityRole="button"
				accessibilityState={{ selected: active }}
				style={[styles.sessionRow, active && styles.sessionRowActive]}
			>
				<Avatar initials={initialsOf(contactLabel)} size={38} />
				<View style={styles.rowText}>
					<Txt style={[styles.rowName, styles.rowNameClear]} numberOfLines={1}>
						{contactLabel}
					</Txt>
					<Txt style={styles.rowAddress} numberOfLines={1}>
						{session.contactAddress}
					</Txt>
					<View style={styles.chips}>
						<ChannelChip session={session} />
						<StateChip session={session} />
					</View>
					<Txt style={styles.rowSnippet} numberOfLines={1}>
						{session.snippet || 'No messages yet'}
					</Txt>
				</View>
			</Pressable>
			{deleting ? (
				<ActivityIndicator
					size="small"
					color={colors.textMuted}
					style={[styles.rowSpinner, styles.rowDeleteSlot]}
				/>
			) : (
				<Pressable
					onPress={onDelete}
					accessibilityRole="button"
					accessibilityLabel={`Delete session with ${contactLabel}`}
					hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
					style={({ pressed }) => [styles.iconBtn, styles.rowDeleteSlot, pressed && styles.pressed]}
				>
					<Icon name="trash-2" size={14} color={colors.textGhost} />
				</Pressable>
			)}
		</View>
	);
}

/** The channel a session runs on, in the Inbox's dot-plus-label language. */
function ChannelChip({ session }: { session: TesterSession }) {
	const meta = CHANNEL_META[session.channel];
	return (
		<View style={styles.channelChip}>
			<Dot color={meta.color} size={6} />
			<Txt style={styles.channelChipTxt}>{meta.label}</Txt>
		</View>
	);
}

/** Where the agent's scheduling state machine stands, as a StatusBadge. */
function StateChip({ session }: { session: TesterSession }) {
	const meta = STATE_META[session.state];
	return <Pill label={meta.label} color={meta.color} background={meta.bg} />;
}

/* ------------------------------- Conversation ----------------------------- */

function Conversation({
	session,
	detail,
	turn,
	loading,
	error,
	sendError,
	pending,
	sending,
	busy,
	draft,
	deleting,
	voice,
	canPlayReply,
	replayInert,
	onPlayReply,
	onBack,
	onChangeDraft,
	onSend,
	onDelete,
}: {
	session: TesterSession | null;
	detail: TesterSessionDetail | null;
	turn: TesterTurn | null;
	loading: boolean;
	error: string | null;
	sendError: string | null;
	/** The optimistic customer turn for *this* session, or null. */
	pending: string | null;
	/** A turn is running for this session (the thinking bubble). */
	sending: boolean;
	/** A turn is running for some session — the composer takes one at a time. */
	busy: boolean;
	draft: string;
	deleting: boolean;
	/** The spoken call loop, or null when this session can't be held out loud. */
	voice: VoiceCall | null;
	/** Whether either voice can read a reply aloud. */
	canPlayReply: boolean;
	/** A call is being held, so replaying an old line would fight it for the air. */
	replayInert: boolean;
	onPlayReply: (text: string) => Promise<void>;
	onBack?: () => void;
	onChangeDraft: (text: string) => void;
	onSend: () => void;
	onDelete: (session: TesterSession) => void;
}) {
	const scrollRef = useRef<ScrollView>(null);

	if (!session) {
		return (
			<View style={[styles.convo, styles.convoEmpty]}>
				<Txt style={styles.placeholder}>Pick a session, or start a new one.</Txt>
			</View>
		);
	}

	const messages = detail?.messages ?? [];
	// The engine's outcome belongs to the turn that produced the newest reply, so
	// it's captioned under that one message rather than the whole transcript.
	const lastRivusIndex = messages.reduce(
		(found, message, index) => (message.author === 'rivus' ? index : found),
		-1,
	);
	const firstName = (session.contactName || session.contactAddress).split(/\s+/)[0] ?? '';
	// A phone session is a call: you speak rather than write, and Rivus has
	// already said hello before the first thing you say.
	const onCall = session.channel === 'phone';
	// Nothing to send (or a turn already running, here or in another session) — the
	// button greys out rather than silently ignoring the press.
	const inert = busy || draft.trim() === '';

	/**
	 * Enter sends the message; Shift+Enter writes a newline.
	 *
	 * Web only: react-native-web routes the browser's keydown here, so the
	 * modifier is real and `preventDefault` is what keeps the sending Enter from
	 * also typing a newline into the box. On device there is no Shift to hold and
	 * the return key belongs to the keyboard, so the composer keeps inserting
	 * newlines there and sending stays on the button.
	 *
	 * A press that isn't sendable (empty draft, or a turn still running) does
	 * nothing at all — `onSend` no-ops, exactly as the greyed-out button does.
	 */
	const onKeyPress = (event: TextInputKeyPressEvent) => {
		if (!isSendKeyPress(event)) {
			return;
		}
		event.preventDefault();
		onSend();
	};

	return (
		<View style={styles.convo}>
			<View style={styles.convoHead}>
				{onBack ? (
					<Pressable
						onPress={onBack}
						accessibilityRole="button"
						accessibilityLabel="Back to sessions"
						style={styles.backBtn}
					>
						<Icon name="chevron-left" size={22} color={colors.brandPurple} />
					</Pressable>
				) : null}
				<Avatar initials={initialsOf(session.contactName || session.contactAddress)} size={38} />
				<View style={styles.convoIdentity}>
					<Txt style={styles.convoName} numberOfLines={1}>
						{session.contactName || session.contactAddress}
					</Txt>
					<Txt style={styles.convoSub} numberOfLines={1}>
						{session.contactAddress}
					</Txt>
					<View style={styles.chips}>
						<ChannelChip session={session} />
						<StateChip session={session} />
					</View>
				</View>
				{deleting ? (
					<ActivityIndicator size="small" color={colors.textMuted} />
				) : (
					<Pressable
						onPress={() => onDelete(session)}
						accessibilityRole="button"
						accessibilityLabel="Delete this session"
						hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
						style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
					>
						<Icon name="trash-2" size={16} color={colors.textMuted} />
					</Pressable>
				)}
			</View>

			{loading ? (
				<ActivityIndicator color={colors.brandPurple} style={styles.detailLoading} />
			) : error ? (
				<View style={styles.detailErrorWrap}>
					<Txt style={styles.errorTxt}>{error}</Txt>
				</View>
			) : (
				<ScrollView
					ref={scrollRef}
					style={styles.thread}
					contentContainerStyle={styles.threadContent}
					onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
				>
					{messages.length === 0 && pending === null ? (
						<Txt style={styles.placeholder}>
							{onCall
								? // The greeting itself lives in the API, so don't quote it here —
									// say what happened, and let the first turn show the wording.
									`Rivus answers the call with a greeting — say something as ${firstName || 'the caller'} to run the first turn.`
								: `Write the first message as ${firstName || 'this contact'} to start the agent.`}
						</Txt>
					) : null}
					{messages.map((message, index) => (
						<Turn
							key={message.id}
							message={message}
							caption={index === lastRivusIndex ? turn : null}
							channel={session.channel}
							canPlay={canPlayReply}
							playInert={replayInert}
							onPlay={onPlayReply}
						/>
					))}
					{pending !== null ? (
						<View style={styles.customerCol}>
							<View style={[styles.bubble, styles.customerBubble, styles.pendingBubble]}>
								<Txt style={styles.customerBubbleTxt}>{pending}</Txt>
							</View>
						</View>
					) : null}
					{sending ? (
						<View style={styles.rivusRow}>
							<RivusBadge size={RIVUS_MARK} radius={radii.sm} />
							<View style={[styles.bubble, styles.rivusBubble]}>
								<ActivityIndicator color={colors.brandPurple} size="small" />
							</View>
						</View>
					) : null}
				</ScrollView>
			)}

			<View style={styles.composerWrap}>
				{sendError ? <Txt style={styles.errorTxt}>{sendError}</Txt> : null}
				{voice?.state.error ? <Txt style={styles.errorTxt}>{voice.state.error}</Txt> : null}
				<View style={styles.composer}>
					{/* A multiline input never fires onSubmitEditing, so the send key is
					    handled on keydown instead (see `onKeyPress`). */}
					<TextInput
						style={[styles.composerInput, IS_WEB && styles.composerInputWeb]}
						value={draft}
						onChangeText={onChangeDraft}
						onKeyPress={IS_WEB ? onKeyPress : undefined}
						placeholder={
							onCall
								? `Speak as ${firstName || 'the caller'}…`
								: `Write as ${firstName || 'the contact'}…`
						}
						placeholderTextColor={colors.textHint}
						multiline
					/>
					{voice ? <MicButton voice={voice} busy={busy} /> : null}
					<Pressable
						onPress={onSend}
						disabled={inert}
						accessibilityRole="button"
						accessibilityLabel="Send message"
						accessibilityState={{ disabled: inert, busy: sending }}
						// react-native-web doesn't derive aria-* from accessibilityState.
						aria-busy={sending}
						aria-disabled={inert}
						style={({ pressed }) => [
							styles.sendBtnWrap,
							inert && styles.sendBtnDisabled,
							pressed && !inert && styles.pressed,
						]}
					>
						<BrandGradient style={styles.sendBtn}>
							<Icon name="arrow-up" size={18} color="#fff" />
						</BrandGradient>
					</Pressable>
				</View>
				{voice?.active ? (
					// While the call is being held, the hint row says where the loop is —
					// that is the only feedback there is for something happening off-screen.
					<View style={styles.voiceHintRow}>
						{voice.state.phase === 'recording' ? <Dot color={colors.red} size={7} /> : null}
						<Txt style={styles.composerHint}>{voiceHint(voice)}</Txt>
					</View>
				) : IS_WEB ? (
					<Txt style={styles.composerHint}>
						{voice
							? 'Enter to send · Shift + Enter for a new line · or tap the mic and talk'
							: 'Enter to send · Shift + Enter for a new line'}
					</Txt>
				) : null}
			</View>
		</View>
	);
}

/** What the composer says for each leg of a call being held out loud. */
function voiceHint(voice: VoiceCall): string {
	if (voice.state.hint !== '') {
		return voice.state.hint;
	}
	switch (voice.state.phase) {
		case 'transcribing':
			return 'Working out what you said…';
		case 'sending':
			return 'Rivus is thinking…';
		case 'speaking':
			return 'Rivus is speaking…';
		default:
			return '';
	}
}

/** The icon that says what the microphone is doing right now. */
function micIcon(phase: VoiceCall['state']['phase']): FeatherName {
	if (phase === 'recording') {
		return 'square';
	}
	return phase === 'speaking' ? 'volume-2' : 'mic';
}

/**
 * The caller's own side of a held call: tap to talk, tap again when you're done,
 * and an escape hatch beside it while the call is running.
 *
 * Deliberately neutral rather than gradient — the signature gradient marks
 * Rivus-the-agent (DESIGN_SYSTEM.md), and this button is the *customer*
 * speaking, the same reason their bubbles stay grey.
 */
function MicButton({ voice, busy }: { voice: VoiceCall; busy: boolean }) {
	const { phase } = voice.state;
	const recording = phase === 'recording';
	const working = phase === 'transcribing' || phase === 'sending';
	// Nothing to tap while a turn is running — here, or typed in another session.
	const disabled = working || phase === 'speaking' || (!voice.active && busy);
	return (
		<>
			{voice.active ? (
				<Pressable
					onPress={voice.exit}
					accessibilityRole="button"
					accessibilityLabel="End voice mode"
					hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
					style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
				>
					<Icon name="x" size={15} color={colors.textMuted} />
				</Pressable>
			) : null}
			<Pressable
				onPress={recording ? voice.stop : voice.start}
				disabled={disabled}
				accessibilityRole="button"
				accessibilityLabel={recording ? 'Stop talking and run the turn' : 'Speak as the caller'}
				accessibilityState={{ disabled, busy: working }}
				// react-native-web doesn't derive aria-* from accessibilityState.
				aria-busy={working}
				aria-disabled={disabled}
				style={({ pressed }) => [
					styles.micBtn,
					recording && styles.micBtnRecording,
					disabled && styles.micBtnDisabled,
					pressed && !disabled && styles.pressed,
				]}
			>
				{working ? (
					<ActivityIndicator size="small" color={colors.textMuted} />
				) : (
					<Icon name={micIcon(phase)} size={17} color={recording ? colors.red : colors.textSub} />
				)}
			</Pressable>
		</>
	);
}

/** One transcript turn: the impersonated customer, Rivus, a teammate, or a note. */
function Turn({
	message,
	caption,
	channel,
	canPlay,
	playInert,
	onPlay,
}: {
	message: Message;
	caption: TesterTurn | null;
	/** The session's channel — it decides which side doors a reply gets. */
	channel: TesterSession['channel'];
	/** Whether anything on this platform can read a reply out loud. */
	canPlay: boolean;
	/** A held call owns the audio right now, so the replay button waits its turn. */
	playInert: boolean;
	onPlay: (text: string) => Promise<void>;
}) {
	// True only while the audio is being fetched: playback itself is deliberately
	// not awaited, so tapping again restarts the line rather than being ignored.
	const [loadingSpeech, setLoadingSpeech] = useState(false);
	if (message.author === 'note') {
		return (
			<View style={styles.noteWrap}>
				<Pill
					label={message.body}
					color={colors.brandPurpleInk}
					background={colors.purpleTint}
					style={styles.note}
				/>
			</View>
		);
	}

	// The customer turns are the ones staff typed, but they are still the *customer*
	// side of the conversation, so they stay neutral: the signature gradient marks
	// Rivus-the-agent only (DESIGN_SYSTEM.md), which is why the inbox keeps the
	// customer's bubbles grey too. Here they're right-aligned — staff are the ones
	// writing them — while Rivus answers from the left.
	if (message.author === 'customer') {
		return (
			<View style={styles.customerCol}>
				<View style={[styles.bubble, styles.customerBubble]}>
					<Txt style={styles.customerBubbleTxt}>{message.body}</Txt>
				</View>
				<Txt style={styles.turnTime}>{clockTime(message.createdAt)}</Txt>
			</View>
		);
	}

	const isRivus = message.author === 'rivus';
	const emailChannel = channel === 'email';
	const subject = caption?.delivery.subject ?? '';
	// The exact body the agent would have emailed. Only a send hands one back, so
	// it's always this session's — the caption clears with the selection.
	const html = caption?.delivery.html ?? '';
	// On a call the delivery is the whole spoken line, sign-off and all — more
	// than the transcript records, which is exactly what's worth hearing.
	const speech = channel === 'phone' ? (caption?.delivery.text ?? '') : '';
	return (
		<View style={styles.rivusRow}>
			{isRivus ? (
				// The one gradient in the transcript: the agent's own mark.
				<RivusBadge size={RIVUS_MARK} radius={radii.sm} />
			) : (
				// A human teammate's reply — a neutral mark, never Rivus's.
				<View style={styles.agentMark}>
					<Icon name="user" size={13} color={colors.textMuted} />
				</View>
			)}
			<View style={styles.rivusCol}>
				{isRivus ? null : <Txt style={styles.authorLabel}>Team member</Txt>}
				<View style={[styles.bubble, styles.rivusBubble]}>
					<Txt style={styles.rivusBubbleTxt}>{message.body}</Txt>
				</View>
				{caption ? <Txt style={styles.caption}>outcome: {caption.outcome}</Txt> : null}
				{caption && emailChannel && subject ? (
					<Txt style={styles.caption}>subject: {subject}</Txt>
				) : null}
				{caption?.call === 'ended' ? (
					// Where the caller would hear the line and then silence — the outcome
					// alone doesn't say the call is over.
					<View style={styles.tertiaryRow}>
						<Icon name="phone-off" size={12} color={colors.textMuted} />
						<Txt style={styles.caption}>the call would end here</Txt>
					</View>
				) : null}
				{emailChannel && html && IS_WEB ? (
					<Pressable
						onPress={() => openEmailPreview(html)}
						accessibilityRole="button"
						accessibilityLabel="Preview the email Rivus would have sent"
						hitSlop={SIDE_DOOR_HIT_SLOP}
						style={({ pressed }) => [styles.tertiaryRow, pressed && styles.pressed]}
					>
						<Icon name="external-link" size={12} color={colors.brandPurple} />
						<Txt style={styles.previewTxt}>Preview email</Txt>
					</Pressable>
				) : null}
				{speech && canPlay ? (
					<Pressable
						onPress={() => {
							setLoadingSpeech(true);
							void onPlay(speech).finally(() => setLoadingSpeech(false));
						}}
						// Inert while a held call has the audio, and while a fetch is already
						// out — a second press mid-fetch would only buy the same line twice
						// and race the copies against each other. Replaying once the line is
						// *playing* stays allowed: that's "say it again from the top".
						disabled={playInert || loadingSpeech}
						accessibilityRole="button"
						accessibilityLabel="Play Rivus’s reply out loud"
						accessibilityState={{ busy: loadingSpeech, disabled: playInert || loadingSpeech }}
						aria-busy={loadingSpeech}
						aria-disabled={playInert || loadingSpeech}
						hitSlop={SIDE_DOOR_HIT_SLOP}
						style={({ pressed }) => [
							styles.tertiaryRow,
							playInert && styles.sideDoorInert,
							pressed && !playInert && !loadingSpeech && styles.pressed,
						]}
					>
						{loadingSpeech ? (
							<ActivityIndicator
								size="small"
								color={colors.brandPurple}
								style={styles.playSpinner}
							/>
						) : (
							<Icon name="volume-2" size={12} color={colors.brandPurple} />
						)}
						<Txt style={styles.previewTxt}>Play reply</Txt>
					</Pressable>
				) : null}
				<Txt style={styles.turnTime}>{clockTime(message.createdAt)}</Txt>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	root: { flex: 1, minHeight: 0 },
	row: { flex: 1, flexDirection: 'row', minHeight: 0 },

	// Page header
	head: {
		paddingHorizontal: 22,
		paddingTop: 20,
		paddingBottom: 14,
		borderBottomWidth: 1,
		borderBottomColor: colors.border,
		backgroundColor: colors.surface,
	},
	title: { fontFamily: font.semibold, fontSize: 20 },
	subtitle: {
		fontFamily: font.regular,
		fontSize: 13,
		lineHeight: 19,
		color: colors.textMuted,
		marginTop: 3,
		maxWidth: 620,
	},

	// Session list
	list: {
		width: 320,
		borderRightWidth: 1,
		borderRightColor: colors.border,
		backgroundColor: colors.surfaceAlt,
	},
	listFull: { width: '100%', flex: 1, borderRightWidth: 0 },
	listHead: {
		gap: 12,
		paddingHorizontal: 16,
		paddingTop: 16,
		paddingBottom: 14,
		borderBottomWidth: 1,
		borderBottomColor: colors.borderSoft,
	},
	listHeadTop: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
	},
	listTitle: { fontFamily: font.semibold, fontSize: 15 },
	listLoading: { paddingVertical: 28 },
	listError: {
		fontFamily: font.medium,
		fontSize: 12.5,
		color: colors.redInk,
		paddingHorizontal: 16,
		paddingTop: 12,
	},
	listScroll: { padding: 8, gap: 4 },
	iconBtn: {
		width: 28,
		height: 28,
		alignItems: 'center',
		justifyContent: 'center',
		borderRadius: radii.sm,
	},
	pressed: { opacity: 0.6 },

	sessionRow: {
		flexDirection: 'row',
		gap: 11,
		padding: 11,
		borderRadius: radii.xl,
		borderWidth: 1,
		borderColor: 'transparent',
	},
	sessionRowActive: { backgroundColor: colors.surface, borderColor: colors.border },
	rowText: { flex: 1, minWidth: 0, gap: 3 },
	rowName: { fontFamily: font.semibold, fontSize: 13.5 },
	// Keep the name clear of the delete overlay in the row's top-right corner.
	rowNameClear: { paddingRight: 30 },
	rowSpinner: { width: 28, height: 28 },
	// The delete affordance overlaid on a session row (a sibling of the row's own
	// Pressable — see SessionRow), pinned where the old inline trash sat.
	rowDeleteSlot: { position: 'absolute', top: 8, right: 8 },
	rowAddress: { fontFamily: font.regular, fontSize: 11.5, color: colors.textMuted },
	rowSnippet: { fontFamily: font.regular, fontSize: 12, color: colors.textBody },
	chips: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 6,
		flexWrap: 'wrap',
		marginVertical: 2,
	},
	channelChip: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 6,
		paddingVertical: 3,
		paddingHorizontal: 9,
		borderRadius: radii.pill,
		backgroundColor: colors.chipBg,
	},
	channelChipTxt: { fontFamily: font.semibold, fontSize: 11, color: colors.textSub },

	// Empty state
	emptyWrap: { padding: 16 },
	empty: { gap: 10, alignItems: 'flex-start' },
	emptyTitle: { fontFamily: font.semibold, fontSize: 14.5 },
	emptyBody: { fontFamily: font.regular, fontSize: 12.5, lineHeight: 18, color: colors.textMuted },

	// Notices
	noticeWrap: { padding: 22, alignItems: 'center' },
	notice: { width: '100%', maxWidth: 480, gap: 10, alignItems: 'flex-start' },
	noticeIcon: {
		width: 40,
		height: 40,
		borderRadius: radii.md,
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: colors.field,
	},
	noticeTitle: { fontFamily: font.semibold, fontSize: 15 },
	noticeBody: { fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: colors.textMuted },

	// Conversation
	convo: { flex: 1, minWidth: 0, backgroundColor: colors.surface },
	convoEmpty: { alignItems: 'center', justifyContent: 'center' },
	convoHead: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		paddingVertical: 12,
		paddingHorizontal: 18,
		borderBottomWidth: 1,
		borderBottomColor: colors.borderSoft,
	},
	backBtn: { width: 28, alignItems: 'center', justifyContent: 'center' },
	convoIdentity: { flex: 1, minWidth: 0, gap: 1 },
	convoName: { fontFamily: font.semibold, fontSize: 15 },
	convoSub: { fontFamily: font.regular, fontSize: 12, color: colors.textMuted },
	detailLoading: { paddingVertical: 40 },
	detailErrorWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
	thread: { flex: 1, backgroundColor: colors.appBg },
	threadContent: { padding: 16, gap: 10 },
	placeholder: {
		fontFamily: font.regular,
		fontSize: 13,
		color: colors.textMuted,
		textAlign: 'center',
		padding: 18,
	},

	// Turns
	bubble: { paddingVertical: 9, paddingHorizontal: 12, borderRadius: radii.lg },
	customerCol: { alignSelf: 'flex-end', maxWidth: '85%', alignItems: 'flex-end', gap: 3 },
	// The impersonated customer: a neutral chip-toned bubble, as the inbox gives
	// the customer's side. The gradient belongs to Rivus alone.
	customerBubble: {
		alignSelf: 'flex-end',
		maxWidth: '100%',
		backgroundColor: colors.chipBg,
		borderWidth: 1,
		borderColor: colors.border,
		borderBottomRightRadius: 3,
	},
	customerBubbleTxt: {
		fontFamily: font.regular,
		fontSize: 13.5,
		color: colors.text,
		lineHeight: 20,
	},
	pendingBubble: { opacity: 0.72 },
	// Rivus (and a teammate) answer from the left, behind their identity mark.
	rivusRow: {
		flexDirection: 'row',
		alignSelf: 'flex-start',
		alignItems: 'flex-start',
		gap: 8,
		maxWidth: '92%',
	},
	rivusCol: { flexShrink: 1, minWidth: 0, gap: 3 },
	agentMark: {
		width: RIVUS_MARK,
		height: RIVUS_MARK,
		borderRadius: radii.sm,
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: colors.avatarBg,
	},
	rivusBubble: {
		alignSelf: 'flex-start',
		backgroundColor: colors.surface,
		borderWidth: 1,
		borderColor: colors.border,
		borderBottomLeftRadius: 3,
	},
	rivusBubbleTxt: { fontFamily: font.regular, fontSize: 13.5, color: colors.text, lineHeight: 20 },
	// The quiet row under a reply: the call-ended marker and the side-door buttons
	// (preview the email, play the reply) — never the screen's action.
	tertiaryRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 5,
		alignSelf: 'flex-start',
		paddingVertical: 2,
		paddingHorizontal: 2,
	},
	previewTxt: { fontFamily: font.semibold, fontSize: 11.5, color: colors.brandPurple },
	// Sized to the icon it stands in for, so the row doesn't jump while the audio
	// is fetched.
	playSpinner: { width: 12, height: 12 },
	// A replay the held call has benched — visibly waiting, not gone.
	sideDoorInert: { opacity: 0.4 },
	authorLabel: {
		fontFamily: font.semibold,
		fontSize: 10.5,
		letterSpacing: 0.7,
		textTransform: 'uppercase',
		color: colors.textFaint,
		paddingHorizontal: 2,
	},
	caption: {
		fontFamily: font.medium,
		fontSize: 11.5,
		color: colors.textMuted,
		paddingHorizontal: 2,
	},
	turnTime: {
		fontFamily: font.regular,
		fontSize: 10.5,
		color: colors.textHint,
		paddingHorizontal: 2,
	},
	noteWrap: { alignItems: 'center' },
	note: { alignSelf: 'center', maxWidth: '92%' },

	// Composer
	composerWrap: {
		gap: 8,
		paddingVertical: 12,
		paddingHorizontal: 16,
		borderTopWidth: 1,
		borderTopColor: colors.borderSoft,
		backgroundColor: colors.surface,
	},
	composer: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 10,
		backgroundColor: colors.fieldSoft,
		borderWidth: 1,
		borderColor: colors.borderField,
		borderRadius: radii.xl,
		paddingVertical: 10,
		paddingHorizontal: 14,
	},
	composerInput: {
		flex: 1,
		fontFamily: font.regular,
		fontSize: 14,
		color: colors.text,
		maxHeight: 120,
		padding: 0,
	},
	// 16px is the threshold below which mobile Safari auto-zooms a focused input.
	composerInputWeb: { fontSize: 16 },
	// The send key is invisible until someone tries it — name it, quietly.
	composerHint: {
		fontFamily: font.medium,
		fontSize: 11.5,
		color: colors.textHint,
		paddingHorizontal: 2,
	},
	// The caller's microphone. Neutral tones on purpose: the gradient is Rivus's
	// mark, and this button is the customer's side of the call.
	micBtn: {
		width: 38,
		height: 38,
		borderRadius: radii.pill,
		alignItems: 'center',
		justifyContent: 'center',
		borderWidth: 1,
		borderColor: colors.borderField,
		backgroundColor: colors.surface,
	},
	micBtnRecording: { borderColor: colors.red },
	micBtnDisabled: { opacity: 0.5 },
	voiceHintRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
	sendBtnWrap: { borderRadius: radii.md },
	sendBtnDisabled: { opacity: 0.5 },
	sendBtn: {
		width: 38,
		height: 38,
		borderRadius: radii.md,
		alignItems: 'center',
		justifyContent: 'center',
	},

	errorTxt: { fontFamily: font.medium, fontSize: 12.5, lineHeight: 18, color: colors.redInk },
});

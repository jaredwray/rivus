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
	useWindowDimensions,
	View,
} from 'react-native';
import {
	ApiError,
	type Message,
	type TesterSession,
	type TesterSessionDetail,
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
	Txt,
} from '@/src/components/ui';
import { CHANNEL_META, STATE_META } from '@/src/tester/meta';
import { NewSessionModal } from '@/src/tester/NewSessionModal';
import { colors, font, radii, SIDEBAR_BREAKPOINT } from '@/src/theme/tokens';
import { useDocumentTitle } from '@/src/theme/useDocumentTitle';

type FeatherName = ComponentProps<typeof Feather>['name'];

// Mobile Safari zooms the page when a focused input's font is under 16px, which
// shoves the send button off-screen — same guard RivusChat's composer uses.
const IS_WEB = Platform.OS === 'web';

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
	// The most recent turn's engine result, for the caption under the last reply.
	// Only a send produces one, so it clears whenever the selection changes.
	const [turn, setTurn] = useState<TesterTurn | null>(null);
	const [draft, setDraft] = useState('');
	// The customer turn we've optimistically appended while the engine runs.
	const [pending, setPending] = useState<string | null>(null);
	const [sending, setSending] = useState(false);
	const [sendError, setSendError] = useState<string | null>(null);

	const load = useCallback(
		async (isActive: () => boolean = () => true) => {
			// Non-staff get the explanation card below; don't fire a request the API
			// is only going to reject.
			if (!accountId || !isStaff) {
				setLoading(false);
				return;
			}
			setLoading(true);
			setLoadError(null);
			setActionError(null);
			try {
				const { data } = await client.listTesterSessions(token);
				if (isActive()) {
					setSessions([...data].sort(byActivity));
				}
			} catch (caught) {
				if (isActive()) {
					setSessions([]);
					setLoadError(caught instanceof Error ? caught : new Error('Could not load sessions.'));
				}
			} finally {
				if (isActive()) {
					setLoading(false);
				}
			}
		},
		[client, token, accountId, isStaff],
	);

	// `load` is re-created whenever the active company is, so this both loads on
	// mount and starts the next company clean — one company's selection or
	// transcript must never show under another's name.
	useEffect(() => {
		let active = true;
		setSelectedId(null);
		setDetail(null);
		setTurn(null);
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
				if (isActive()) {
					setDetail(result);
				}
			} catch (caught) {
				if (isActive()) {
					setDetail(null);
					setDetailError(messageFor(caught, 'Could not load this session.'));
				}
			} finally {
				if (isActive()) {
					setDetailLoading(false);
				}
			}
		},
		[client, token, accountId],
	);

	// Whatever the user last picked, falling back to the top of the list.
	const selected = sessions.find((item) => item.id === selectedId) ?? sessions[0] ?? null;
	// Re-load only when the selected *id* changes — not when a turn replaces the
	// session object in the list, which would refetch on every send.
	const selectedKey = selected?.id ?? null;
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

	const onSend = useCallback(async () => {
		const text = draft.trim();
		if (!selected || text === '' || sending) {
			return;
		}
		setSending(true);
		setSendError(null);
		setDraft('');
		setPending(text);
		try {
			const result = await client.sendTesterMessage(token, selected.id, { text });
			// The response is authoritative for both panes: it carries the full
			// transcript (replacing the optimistic turn) and the updated session row.
			setTurn(result);
			setDetail({ session: result.session, messages: result.messages });
			setSessions((prev) =>
				prev
					.map((item) => (item.id === result.session.id ? result.session : item))
					.sort(byActivity),
			);
		} catch (caught) {
			// Put the text back in the composer so the turn can be retried as typed.
			setDraft(text);
			setSendError(messageFor(caught, 'Could not run that turn.'));
		} finally {
			setPending(null);
			setSending(false);
		}
	}, [draft, token, selected, sending, client]);

	const performDelete = useCallback(
		async (target: TesterSession) => {
			if (deletingId) {
				return;
			}
			setActionError(null);
			setDeletingId(target.id);
			try {
				await client.deleteTesterSession(token, target.id);
				setSessions((prev) => prev.filter((item) => item.id !== target.id));
				if (selected?.id === target.id) {
					setSelectedId(null);
					setDetail(null);
					setTurn(null);
					setShowConversation(false);
				}
			} catch (caught) {
				setActionError(messageFor(caught, 'Could not delete that session.'));
			} finally {
				setDeletingId(null);
			}
		},
		[client, token, selected, deletingId],
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

	const conversationPane = (
		<Conversation
			session={selected}
			detail={detail}
			turn={turn}
			loading={detailLoading}
			error={detailError}
			sendError={sendError}
			pending={pending}
			sending={sending}
			draft={draft}
			deleting={selected !== null && deletingId === selected.id}
			onBack={wide ? undefined : () => setShowConversation(false)}
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
	draft,
	deleting,
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
	pending: string | null;
	sending: boolean;
	draft: string;
	deleting: boolean;
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
	// Nothing to send (or a turn already running) — the button greys out rather
	// than silently ignoring the press.
	const inert = sending || draft.trim() === '';

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
							Write the first message as {firstName || 'this contact'} to start the agent.
						</Txt>
					) : null}
					{messages.map((message, index) => (
						<Turn
							key={message.id}
							message={message}
							caption={index === lastRivusIndex ? turn : null}
							emailChannel={session.channel === 'email'}
						/>
					))}
					{pending !== null ? (
						<BrandGradient style={[styles.bubble, styles.customerBubble, styles.pendingBubble]}>
							<Txt style={styles.customerBubbleTxt}>{pending}</Txt>
						</BrandGradient>
					) : null}
					{sending ? (
						<View style={[styles.bubble, styles.rivusBubble]}>
							<ActivityIndicator color={colors.brandPurple} size="small" />
						</View>
					) : null}
				</ScrollView>
			)}

			<View style={styles.composerWrap}>
				{sendError ? <Txt style={styles.errorTxt}>{sendError}</Txt> : null}
				<View style={styles.composer}>
					{/* A multiline input's Enter inserts a newline (onSubmitEditing never
					    fires), so sending is via the button — no dead submit handler. */}
					<TextInput
						style={[styles.composerInput, IS_WEB && styles.composerInputWeb]}
						value={draft}
						onChangeText={onChangeDraft}
						placeholder={`Write as ${firstName || 'the contact'}…`}
						placeholderTextColor={colors.textHint}
						multiline
					/>
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
			</View>
		</View>
	);
}

/** One transcript turn: the impersonated customer, Rivus, a teammate, or a note. */
function Turn({
	message,
	caption,
	emailChannel,
}: {
	message: Message;
	caption: TesterTurn | null;
	emailChannel: boolean;
}) {
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

	// The customer turns are the ones staff typed — the impersonated side, so they
	// wear the signature gradient exactly as the user's own turns do in RivusChat.
	if (message.author === 'customer') {
		return (
			<View style={styles.customerCol}>
				<BrandGradient style={[styles.bubble, styles.customerBubble]}>
					<Txt style={styles.customerBubbleTxt}>{message.body}</Txt>
				</BrandGradient>
				<Txt style={styles.turnTime}>{clockTime(message.createdAt)}</Txt>
			</View>
		);
	}

	const subject = caption?.delivery.subject ?? '';
	return (
		<View style={styles.rivusCol}>
			{message.author === 'agent' ? <Txt style={styles.authorLabel}>Team member</Txt> : null}
			<View style={[styles.bubble, styles.rivusBubble]}>
				<Txt style={styles.rivusBubbleTxt}>{message.body}</Txt>
			</View>
			{caption ? <Txt style={styles.caption}>outcome: {caption.outcome}</Txt> : null}
			{caption && emailChannel && subject ? (
				<Txt style={styles.caption}>subject: {subject}</Txt>
			) : null}
			<Txt style={styles.turnTime}>{clockTime(message.createdAt)}</Txt>
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
	customerBubble: { alignSelf: 'flex-end', maxWidth: '100%', borderBottomRightRadius: 3 },
	customerBubbleTxt: { fontFamily: font.medium, fontSize: 13.5, color: '#fff', lineHeight: 20 },
	pendingBubble: { opacity: 0.72 },
	rivusCol: { alignSelf: 'flex-start', maxWidth: '85%', gap: 3 },
	rivusBubble: {
		alignSelf: 'flex-start',
		backgroundColor: colors.surface,
		borderWidth: 1,
		borderColor: colors.border,
		borderBottomLeftRadius: 3,
	},
	rivusBubbleTxt: { fontFamily: font.regular, fontSize: 13.5, color: colors.text, lineHeight: 20 },
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

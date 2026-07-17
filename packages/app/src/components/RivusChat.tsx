import { Feather } from '@expo/vector-icons';
import type { ChatMessage } from '@rivus/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	ActivityIndicator,
	KeyboardAvoidingView,
	Modal,
	Platform,
	Pressable,
	ScrollView,
	StyleSheet,
	TextInput,
	useWindowDimensions,
	View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createApiClient } from '@/src/api/client';
import { getApiBaseUrl } from '@/src/api/config';
import { useAuth } from '@/src/auth/AuthContext';
import { RivusSymbol } from '@/src/brand/RivusLogo';
import { colors, font, radii, shadowSoft } from '@/src/theme/tokens';
import { BrandGradient } from './Gradient';
import { Dot, Txt } from './ui';

// Web keeps the session in the HttpOnly cookie (sent with credentials), so the
// token is empty there; native holds the bearer token in memory and sends it.
const IS_WEB = Platform.OS === 'web';

type Status = 'idle' | 'sending' | 'error';

/** A chat message with a stable id for React keys (assigned once, on creation). */
interface DisplayMessage extends ChatMessage {
	id: number;
}

/**
 * The Rivus chat. It talks to the API's `POST /v1/chat` (the in-process
 * successor to the standalone agent service); on first open it greets you — the
 * end-to-end proof that the app can reach Rivus and get a reply back.
 *
 * Two presentations share the same conversation logic:
 *
 * - `floating` (the wide layout): a launcher pinned to the bottom-right of every
 *   signed-in screen that opens a small panel above itself. It owns its own open
 *   state.
 * - `fullscreen` (the narrow/mobile layout): no launcher of its own — the chat
 *   icon lives in the top bar, and tapping it opens the conversation full screen.
 *   The host owns the open state and passes it in via `open` / `onClose`.
 *
 * @param bottomOffset Height of bottom chrome the floating launcher must clear
 * (e.g. the mobile tab bar). It already includes the safe-area inset, so we
 * reserve the larger of it and the raw inset rather than summing the two.
 * @param variant Which presentation to render (defaults to `floating`).
 * @param open Controlled open state — only used (and required) for `fullscreen`.
 * @param onClose Called when the `fullscreen` chat asks to close.
 */
export function RivusChat({
	bottomOffset = 0,
	variant = 'floating',
	open: openProp,
	onClose,
}: {
	bottomOffset?: number;
	variant?: 'floating' | 'fullscreen';
	open?: boolean;
	onClose?: () => void;
}) {
	const insets = useSafeAreaInsets();
	const { width, height } = useWindowDimensions();
	const bottomReserve = Math.max(insets.bottom, bottomOffset);

	const { session } = useAuth();
	// Web authenticates chat via the session cookie; native forwards the
	// in-memory bearer token. Either way Rivus recognises the signed-in user and
	// can answer from their company + knowledge base.
	const token = session?.token ?? '';

	// `floating` owns its open state; `fullscreen` is controlled by the host.
	const isFullscreen = variant === 'fullscreen';
	const [internalOpen, setInternalOpen] = useState(false);
	const open = isFullscreen ? openProp === true : internalOpen;
	const close = useCallback(() => {
		if (isFullscreen) {
			onClose?.();
		} else {
			setInternalOpen(false);
		}
	}, [isFullscreen, onClose]);

	const [greeted, setGreeted] = useState(false);
	const [messages, setMessages] = useState<DisplayMessage[]>([]);
	const [draft, setDraft] = useState('');
	const [status, setStatus] = useState<Status>('idle');

	const client = useMemo(
		() => createApiClient(getApiBaseUrl(), undefined, { withCredentials: IS_WEB }),
		[],
	);
	const scrollRef = useRef<ScrollView>(null);
	const seq = useRef(0);

	// Send the conversation so far and append Rivus's reply. The history carries
	// stable ids; the wire format drops them. It's passed in (not read from state)
	// so the callback never closes over a stale `messages`.
	const send = useCallback(
		async (history: DisplayMessage[]) => {
			setStatus('sending');
			try {
				const wire = history.map(({ role, content }) => ({ role, content }));
				const { reply } = await client.chat(wire, token);
				setMessages([...history, { id: seq.current++, role: 'assistant', content: reply }]);
				setStatus('idle');
			} catch {
				setStatus('error');
			}
		},
		[client, token],
	);

	// The first time the panel opens, ask the agent to say hello.
	useEffect(() => {
		if (open && !greeted) {
			setGreeted(true);
			void send([]);
		}
	}, [open, greeted, send]);

	function submit() {
		const text = draft.trim();
		if (text.length === 0 || status === 'sending') {
			return;
		}
		setDraft('');
		const next: DisplayMessage[] = [
			...messages,
			{ id: seq.current++, role: 'user', content: text },
		];
		setMessages(next);
		void send(next);
	}

	const conversation = (
		<ChatConversation
			messages={messages}
			status={status}
			draft={draft}
			onDraft={setDraft}
			onSubmit={submit}
			onClose={close}
			scrollRef={scrollRef}
		/>
	);

	// Mobile: open over the whole screen with a clear close affordance in the
	// header. The chat icon that opens it lives in the top bar (see CompactBar).
	if (isFullscreen) {
		return (
			<Modal
				visible={open}
				animationType="slide"
				onRequestClose={close}
				presentationStyle="overFullScreen"
				transparent={false}
			>
				<KeyboardAvoidingView
					behavior={Platform.OS === 'ios' ? 'padding' : undefined}
					style={styles.fullscreen}
				>
					{/* Hold the safe-area insets on an inner View: with behavior="padding"
					    KeyboardAvoidingView overwrites its own paddingBottom with the
					    keyboard height (0 when closed), which would otherwise wipe out the
					    bottom inset and let the composer collide with the home indicator. */}
					<View
						style={[
							styles.fullscreenInner,
							{ paddingTop: insets.top, paddingBottom: insets.bottom },
						]}
					>
						{conversation}
					</View>
				</KeyboardAvoidingView>
			</Modal>
		);
	}

	const panelWidth = Math.min(360, width - 24);
	const panelHeight = Math.min(460, height - insets.top - bottomReserve - 96);

	return (
		<KeyboardAvoidingView
			// Lift the panel above the iOS soft keyboard so the input stays visible.
			// Android resizes the window itself, and on web there's no soft keyboard
			// to avoid, so the behavior is iOS-only.
			behavior={Platform.OS === 'ios' ? 'padding' : undefined}
			pointerEvents="box-none"
			style={[styles.layer, { right: 18, bottom: bottomReserve + 18 }]}
		>
			{open ? (
				<View style={[styles.panel, { width: panelWidth, height: panelHeight }]}>
					{conversation}
				</View>
			) : null}

			<Pressable
				onPress={() => setInternalOpen((value) => !value)}
				accessibilityRole="button"
				accessibilityLabel={open ? 'Close Rivus chat' : 'Open Rivus chat'}
				style={({ pressed }) => [styles.fabWrap, pressed && styles.pressed]}
			>
				<BrandGradient style={styles.fab}>
					{open ? (
						<Feather name="chevron-down" size={24} color="#fff" />
					) : (
						<Feather name="message-circle" size={26} color="#fff" />
					)}
				</BrandGradient>
			</Pressable>
		</KeyboardAvoidingView>
	);
}

/**
 * The shared chat surface — header, message thread and composer — laid out to
 * fill its parent. Both the floating panel and the fullscreen modal wrap this so
 * the conversation looks and behaves identically in either presentation.
 */
function ChatConversation({
	messages,
	status,
	draft,
	onDraft,
	onSubmit,
	onClose,
	scrollRef,
}: {
	messages: DisplayMessage[];
	status: Status;
	draft: string;
	onDraft: (value: string) => void;
	onSubmit: () => void;
	onClose: () => void;
	scrollRef: React.RefObject<ScrollView | null>;
}) {
	return (
		<>
			<View style={styles.header}>
				<BrandGradient style={styles.headerMark}>
					<RivusSymbol size={18} />
				</BrandGradient>
				<View style={styles.headerText}>
					<Txt style={styles.headerTitle}>Rivus</Txt>
					<View style={styles.headerStatus}>
						<Dot color={colors.green} size={6} />
						<Txt style={styles.headerStatusTxt}>AI assistant</Txt>
					</View>
				</View>
				<Pressable
					onPress={onClose}
					accessibilityRole="button"
					accessibilityLabel="Close Rivus chat"
					hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
					style={styles.headerClose}
				>
					<Feather name="x" size={18} color={colors.textMuted} />
				</Pressable>
			</View>

			<ScrollView
				ref={scrollRef}
				style={styles.thread}
				contentContainerStyle={styles.threadContent}
				onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
			>
				{messages.map((message) => (
					<MessageBubble key={message.id} message={message} />
				))}
				{status === 'sending' ? (
					<View style={[styles.bubble, styles.assistantBubble]}>
						<ActivityIndicator color={colors.brandPurple} size="small" />
					</View>
				) : null}
				{status === 'error' ? (
					<Txt style={styles.errorTxt}>
						Couldn't reach Rivus. Check that the agent is running, then try again.
					</Txt>
				) : null}
			</ScrollView>

			<View style={styles.composer}>
				<TextInput
					value={draft}
					onChangeText={onDraft}
					onSubmitEditing={onSubmit}
					placeholder="Message Rivus…"
					placeholderTextColor={colors.textHint}
					returnKeyType="send"
					// Mobile Safari zooms the page when a focused input's font is under
					// 16px, which shoves the send button off-screen. Hold the input at
					// 16px on web to suppress that; native keeps the designed 14px.
					style={[styles.input, IS_WEB && styles.inputWeb]}
				/>
				<Pressable
					onPress={onSubmit}
					accessibilityRole="button"
					accessibilityLabel="Send message"
					disabled={status === 'sending'}
					style={({ pressed }) => [styles.sendBtnWrap, pressed && styles.pressed]}
				>
					<BrandGradient style={styles.sendBtn}>
						<Feather name="arrow-up" size={18} color="#fff" />
					</BrandGradient>
				</Pressable>
			</View>
		</>
	);
}

function MessageBubble({ message }: { message: ChatMessage }) {
	const isUser = message.role === 'user';
	if (isUser) {
		return (
			<BrandGradient style={[styles.bubble, styles.userBubble]}>
				<Txt style={styles.userBubbleTxt}>{message.content}</Txt>
			</BrandGradient>
		);
	}
	return (
		<View style={[styles.bubble, styles.assistantBubble]}>
			<Txt style={styles.assistantBubbleTxt}>{message.content}</Txt>
		</View>
	);
}

const styles = StyleSheet.create({
	// Overlay layer anchored bottom-right; `box-none` lets touches pass through the
	// empty space around the FAB/panel to the screen beneath.
	layer: {
		position: 'absolute',
		alignItems: 'flex-end',
		gap: 12,
		// Web-only fixed positioning keeps the FAB in view as the page scrolls
		// (react-native-web supports 'fixed'; it's a no-op shape on native).
		...(Platform.OS === 'web' ? { position: 'fixed' as const } : null),
	},
	fabWrap: {
		borderRadius: radii.pill,
		...shadowSoft,
	},
	fab: {
		width: 58,
		height: 58,
		borderRadius: radii.pill,
		alignItems: 'center',
		justifyContent: 'center',
	},
	pressed: {
		opacity: 0.88,
	},
	panel: {
		backgroundColor: colors.surface,
		borderRadius: radii.card,
		borderWidth: 1,
		borderColor: colors.border,
		overflow: 'hidden',
		...shadowSoft,
	},
	// Fullscreen (mobile) container: fills the screen and pads the safe-area insets
	// applied by the wrapping KeyboardAvoidingView.
	fullscreen: {
		flex: 1,
		backgroundColor: colors.surface,
	},
	fullscreenInner: {
		flex: 1,
	},
	header: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 10,
		paddingHorizontal: 14,
		paddingVertical: 12,
		borderBottomWidth: 1,
		borderBottomColor: colors.border,
		backgroundColor: colors.surface,
	},
	headerMark: {
		width: 32,
		height: 32,
		borderRadius: radii.md,
		alignItems: 'center',
		justifyContent: 'center',
	},
	headerText: {
		flex: 1,
	},
	headerTitle: {
		fontFamily: font.bold,
		fontSize: 15,
		color: colors.text,
	},
	headerStatus: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 6,
	},
	headerStatusTxt: {
		fontFamily: font.medium,
		fontSize: 11,
		color: colors.textMuted,
	},
	headerClose: {
		width: 30,
		height: 30,
		alignItems: 'center',
		justifyContent: 'center',
	},
	thread: {
		flex: 1,
		backgroundColor: colors.appBg,
	},
	threadContent: {
		padding: 12,
		gap: 8,
	},
	bubble: {
		maxWidth: '85%',
		paddingVertical: 9,
		paddingHorizontal: 12,
		borderRadius: radii.lg,
	},
	userBubble: {
		alignSelf: 'flex-end',
		borderBottomRightRadius: 3,
	},
	userBubbleTxt: {
		fontFamily: font.medium,
		fontSize: 13.5,
		color: '#fff',
	},
	assistantBubble: {
		alignSelf: 'flex-start',
		backgroundColor: colors.surface,
		borderWidth: 1,
		borderColor: colors.border,
		borderBottomLeftRadius: 3,
	},
	assistantBubbleTxt: {
		fontFamily: font.regular,
		fontSize: 13.5,
		color: colors.text,
	},
	errorTxt: {
		alignSelf: 'flex-start',
		fontFamily: font.medium,
		fontSize: 12.5,
		color: colors.redInk,
	},
	composer: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		padding: 10,
		borderTopWidth: 1,
		borderTopColor: colors.border,
		backgroundColor: colors.surface,
	},
	input: {
		flex: 1,
		fontFamily: font.regular,
		fontSize: 14,
		color: colors.text,
		backgroundColor: colors.field,
		borderWidth: 1,
		borderColor: colors.borderField,
		borderRadius: radii.md,
		paddingVertical: 10,
		paddingHorizontal: 12,
	},
	// 16px is the threshold below which mobile Safari auto-zooms a focused input.
	inputWeb: {
		fontSize: 16,
	},
	sendBtnWrap: {
		borderRadius: radii.md,
	},
	sendBtn: {
		width: 40,
		height: 40,
		borderRadius: radii.md,
		alignItems: 'center',
		justifyContent: 'center',
	},
});

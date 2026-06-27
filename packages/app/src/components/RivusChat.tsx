import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	ActivityIndicator,
	KeyboardAvoidingView,
	Platform,
	Pressable,
	ScrollView,
	StyleSheet,
	TextInput,
	useWindowDimensions,
	View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type ChatMessage, createAgentClient } from '@/src/agent/client';
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
 * A floating "chat with Rivus" launcher pinned to the bottom-right of every
 * signed-in screen. Tapping it opens a small chat panel that talks to the Rivus
 * agent service (`@rivus/agent`). On first open it greets you — the end-to-end
 * proof that the app can reach the agent and get a reply back.
 */
/**
 * @param bottomOffset Height of bottom chrome the launcher must clear (e.g. the
 * mobile tab bar). It already includes the safe-area inset, so we reserve the
 * larger of it and the raw inset rather than summing the two.
 */
export function RivusChat({ bottomOffset = 0 }: { bottomOffset?: number }) {
	const insets = useSafeAreaInsets();
	const { width, height } = useWindowDimensions();
	const bottomReserve = Math.max(insets.bottom, bottomOffset);

	const { session } = useAuth();
	// Web authenticates the agent via the shared session cookie; native forwards
	// the in-memory bearer token. Either way the agent recognises the signed-in
	// user and can answer from their company + knowledge base.
	const token = session?.token ?? '';

	const [open, setOpen] = useState(false);
	const [greeted, setGreeted] = useState(false);
	const [messages, setMessages] = useState<DisplayMessage[]>([]);
	const [draft, setDraft] = useState('');
	const [status, setStatus] = useState<Status>('idle');

	const client = useMemo(
		() => createAgentClient(undefined, undefined, { withCredentials: IS_WEB }),
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
							onPress={() => setOpen(false)}
							accessibilityRole="button"
							accessibilityLabel="Close Rivus chat"
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
							onChangeText={setDraft}
							onSubmitEditing={submit}
							placeholder="Message Rivus…"
							placeholderTextColor={colors.textHint}
							returnKeyType="send"
							style={styles.input}
						/>
						<Pressable
							onPress={submit}
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
				</View>
			) : null}

			<Pressable
				onPress={() => setOpen((value) => !value)}
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

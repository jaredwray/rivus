import type { ConversationId, CustomerId } from '@rivus/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
	ActivityIndicator,
	Pressable,
	ScrollView,
	StyleSheet,
	TextInput,
	useWindowDimensions,
	View,
} from 'react-native';
import {
	ApiError,
	type Conversation,
	type ConversationDetail,
	type Customer,
	type Message,
} from '@/src/api/client';
import { initialsOf, useAuth } from '@/src/auth/AuthContext';
import { BrandGradient } from '@/src/components/Gradient';
import {
	Avatar,
	Dot,
	GradientMark,
	Icon,
	Pill,
	RivusBadge,
	RivusStatusChip,
	Txt,
} from '@/src/components/ui';
import { useInbox } from '@/src/inbox/InboxContext';
import { colors, font, radii } from '@/src/theme/tokens';

type ConversationChannel = Conversation['channel'];

/** Display label and channel dot colour for each channel, sourced from design tokens. */
const CHANNEL_META: Record<ConversationChannel, { label: string; color: string }> = {
	whatsapp: { label: 'WhatsApp', color: colors.green },
	phone: { label: 'Phone', color: colors.brandCyan },
	email: { label: 'Email', color: colors.brandPurple },
	sms: { label: 'SMS', color: colors.textMuted },
};

type Filter = 'all' | 'needs' | 'rivus';

/** Format integer cents as a grouped dollar string (54000 → "$540.00"). */
function formatMoney(cents: number): string {
	const sign = cents < 0 ? '-' : '';
	const abs = Math.abs(cents);
	const dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	return `${sign}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

/** A short clock time like "9:18 AM" for a message/thread timestamp. */
function clockTime(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) {
		return '';
	}
	return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** A relative day label for a thread row: a clock time today, else "Yesterday"/a date. */
function rowTime(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) {
		return '';
	}
	const now = new Date();
	const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const dayMs = 24 * 60 * 60 * 1000;
	if (date >= startOfToday) {
		return clockTime(iso);
	}
	if (date >= new Date(startOfToday.getTime() - dayMs)) {
		return 'Yesterday';
	}
	return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** A day label for the transcript divider: 'Today', 'Yesterday', or a date. */
function dayLabel(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) {
		return 'Today';
	}
	const now = new Date();
	const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const dayMs = 24 * 60 * 60 * 1000;
	if (date >= startOfToday) {
		return 'Today';
	}
	if (date >= new Date(startOfToday.getTime() - dayMs)) {
		return 'Yesterday';
	}
	return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Order conversations newest-activity-first, matching the API's list order. */
function byActivity(a: Conversation, b: Conversation): number {
	return b.lastMessageAt.localeCompare(a.lastMessageAt);
}

export default function InboxScreen() {
	const { session, client } = useAuth();
	const inbox = useInbox();
	const { width } = useWindowDimensions();
	const wide = width >= 760;
	const showContext = width >= 1080;

	const [list, setList] = useState<Conversation[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [filter, setFilter] = useState<Filter>('all');
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [detail, setDetail] = useState<ConversationDetail | null>(null);
	const [detailLoading, setDetailLoading] = useState(false);
	const [detailError, setDetailError] = useState<string | null>(null);
	const [customer, setCustomer] = useState<Customer | null>(null);
	const [showDetail, setShowDetail] = useState(false);

	const [draft, setDraft] = useState('');
	const [busy, setBusy] = useState(false);
	// True once the user taps "Edit" on a held draft: the composer then sends an
	// approved (Rivus) reply rather than a fresh team-member message.
	const [editingDraft, setEditingDraft] = useState(false);

	const load = useCallback(
		async (isActive: () => boolean = () => true) => {
			if (!session) {
				return;
			}
			setLoading(true);
			setError(null);
			try {
				// Page through everything so the filters and counts reflect the whole inbox
				// (the screen has no pagination UI). MAX_PAGES guards a runaway API.
				const all: Conversation[] = [];
				const MAX_PAGES = 50;
				let page = 1;
				let hasNext = true;
				while (hasNext && page <= MAX_PAGES) {
					const { data, meta } = await client.listConversations(session.token, {
						page,
						pageSize: 100,
					});
					all.push(...data);
					hasNext = meta.hasNextPage;
					page += 1;
				}
				if (isActive()) {
					setList(all.sort(byActivity));
				}
			} catch (caught) {
				if (isActive()) {
					setError(caught instanceof ApiError ? caught.message : 'Could not load your inbox.');
				}
			} finally {
				if (isActive()) {
					setLoading(false);
				}
			}
		},
		[client, session],
	);

	useEffect(() => {
		let active = true;
		load(() => active);
		return () => {
			active = false;
		};
	}, [load]);

	const needsCount = useMemo(
		() => list.filter((conversation) => conversation.status === 'needs_attention').length,
		[list],
	);

	const filtered = useMemo(() => {
		if (filter === 'needs') {
			return list.filter((conversation) => conversation.status === 'needs_attention');
		}
		if (filter === 'rivus') {
			return list.filter((conversation) => conversation.status === 'rivus_handling');
		}
		return list;
	}, [list, filter]);

	// The selected thread is whatever the user last picked (falling back to the top
	// of the current filter), looked up against the full list so it survives filtering.
	const selected =
		list.find((conversation) => conversation.id === selectedId) ?? filtered[0] ?? null;

	/**
	 * Load a thread's transcript and linked customer. Extracted as a stable callback
	 * (the `isActive` guard drops results that resolve after unmount / a re-select),
	 * matching the codebase's other loaders.
	 */
	const loadDetail = useCallback(
		async (conversationId: string, customerId: string, isActive: () => boolean = () => true) => {
			if (!session) {
				return;
			}
			// Clear the prior thread's transcript and customer up front so the panels
			// never show one thread's data under another's name while the new one loads.
			setDetail(null);
			setCustomer(null);
			setDetailError(null);
			setDetailLoading(true);
			setEditingDraft(false);
			setDraft('');
			try {
				const result = await client.getConversation(
					session.token,
					conversationId as ConversationId,
				);
				if (!isActive()) {
					return;
				}
				setDetail(result);
				if (customerId) {
					try {
						const linked = await client.getCustomer(session.token, customerId as CustomerId);
						if (isActive()) {
							setCustomer(linked);
						}
					} catch {
						// The linked customer may have been deleted; the panel falls back to the
						// conversation's own contact fields.
						if (isActive()) {
							setCustomer(null);
						}
					}
				} else if (isActive()) {
					setCustomer(null);
				}
			} catch {
				if (isActive()) {
					setDetail(null);
					setDetailError('Could not load this conversation.');
				}
			} finally {
				if (isActive()) {
					setDetailLoading(false);
				}
			}
		},
		[client, session],
	);

	// Re-load only when the *selected id* (or its linked customer) changes — not when a
	// mutation replaces the conversation object in the list, which would otherwise flash
	// the spinner and refetch on every send.
	const selectedKey = selected?.id ?? null;
	const selectedCustomerId = selected?.customerId ?? '';
	useEffect(() => {
		if (!selectedKey) {
			setDetail(null);
			setCustomer(null);
			return;
		}
		let active = true;
		void loadDetail(selectedKey, selectedCustomerId, () => active);
		return () => {
			active = false;
		};
	}, [selectedKey, selectedCustomerId, loadDetail]);

	const pick = (id: string) => {
		setSelectedId(id);
		setShowDetail(true);
	};

	/** Fold a mutation's result back into the detail view, the list, and the badge. */
	const applyDetail = useCallback(
		(result: ConversationDetail) => {
			setDetail(result);
			setList((prev) =>
				prev
					.map((conversation) =>
						conversation.id === result.conversation.id ? result.conversation : conversation,
					)
					.sort(byActivity),
			);
			void inbox.refresh();
		},
		[inbox],
	);

	const onSend = useCallback(async () => {
		const body = draft.trim();
		if (!session || !selected || !body || busy) {
			return;
		}
		setBusy(true);
		try {
			const result = editingDraft
				? await client.approveReply(session.token, selected.id, { body })
				: await client.sendMessage(session.token, selected.id, { body });
			applyDetail(result);
			setDraft('');
			setEditingDraft(false);
		} catch {
			// Leave the text in the composer so the user can retry.
		} finally {
			setBusy(false);
		}
	}, [draft, session, selected, busy, editingDraft, client, applyDetail]);

	const onRivusReply = useCallback(async () => {
		if (!session || !selected || busy) {
			return;
		}
		setBusy(true);
		try {
			const result = await client.replyWithRivus(session.token, selected.id);
			applyDetail(result);
		} catch {
			// Best effort; the thread state is unchanged on failure.
		} finally {
			setBusy(false);
		}
	}, [session, selected, busy, client, applyDetail]);

	const onApprove = useCallback(async () => {
		if (!session || !selected || busy) {
			return;
		}
		setBusy(true);
		try {
			// If the user tapped Edit and changed the composer text, send that edited
			// version; otherwise approve and send the held draft as-is.
			const edited = editingDraft ? draft.trim() : '';
			const result = edited
				? await client.approveReply(session.token, selected.id, { body: edited })
				: await client.approveReply(session.token, selected.id);
			applyDetail(result);
			setDraft('');
			setEditingDraft(false);
		} catch {
			// Best effort.
		} finally {
			setBusy(false);
		}
	}, [session, selected, busy, editingDraft, draft, client, applyDetail]);

	const onEditDraft = () => {
		if (detail) {
			setDraft(detail.conversation.pendingReply);
			setEditingDraft(true);
		}
	};

	if (!session) {
		return null;
	}

	const listView = (
		<ThreadList
			conversations={filtered}
			selectedId={selected?.id ?? null}
			filter={filter}
			needsCount={needsCount}
			onFilter={setFilter}
			onPick={(id) => (wide ? setSelectedId(id) : pick(id))}
			loading={loading}
			error={error}
			full={!wide}
		/>
	);

	const conversationView = (
		<ConversationPane
			conversation={selected}
			detail={detail}
			loading={detailLoading}
			error={detailError}
			busy={busy}
			draft={draft}
			editingDraft={editingDraft}
			onBack={wide ? undefined : () => setShowDetail(false)}
			onChangeDraft={setDraft}
			onSend={onSend}
			onRivusReply={onRivusReply}
			onApprove={onApprove}
			onEditDraft={onEditDraft}
		/>
	);

	if (wide) {
		return (
			<View style={styles.row}>
				{listView}
				{conversationView}
				{showContext ? <Context conversation={selected} customer={customer} /> : null}
			</View>
		);
	}

	return (
		<View style={styles.rowNarrow}>{showDetail && selected ? conversationView : listView}</View>
	);
}

/* ------------------------------ Thread list ------------------------------- */

function ThreadList({
	conversations,
	selectedId,
	filter,
	needsCount,
	onFilter,
	onPick,
	loading,
	error,
	full,
}: {
	conversations: Conversation[];
	selectedId: string | null;
	filter: Filter;
	needsCount: number;
	onFilter: (filter: Filter) => void;
	onPick: (id: string) => void;
	loading: boolean;
	error: string | null;
	full?: boolean;
}) {
	return (
		<View style={[styles.list, full && styles.listFull]}>
			<View style={styles.listHead}>
				<Txt style={styles.listTitle}>Inbox</Txt>
				<View style={styles.filters}>
					<FilterChip label="All" active={filter === 'all'} onPress={() => onFilter('all')} />
					<FilterChip
						label={`Needs you · ${needsCount}`}
						active={filter === 'needs'}
						dot={needsCount > 0}
						onPress={() => onFilter('needs')}
					/>
					<FilterChip label="Rivus" active={filter === 'rivus'} onPress={() => onFilter('rivus')} />
				</View>
			</View>
			{loading ? (
				<ActivityIndicator color={colors.brandPurple} style={styles.listLoading} />
			) : error ? (
				<Txt style={styles.errorTxt}>{error}</Txt>
			) : conversations.length === 0 ? (
				<Txt style={styles.empty}>No conversations here yet.</Txt>
			) : (
				<ScrollView contentContainerStyle={styles.listScroll}>
					{conversations.map((conversation) => {
						const active = conversation.id === selectedId;
						const meta = CHANNEL_META[conversation.channel];
						return (
							<Pressable
								key={conversation.id}
								onPress={() => onPick(conversation.id)}
								style={[styles.threadRow, active && styles.threadRowActive]}
							>
								<View>
									<Avatar initials={initialsOf(conversation.contactName)} size={40} />
									<View style={[styles.chDot, { backgroundColor: meta.color }]} />
								</View>
								<View style={{ flex: 1, minWidth: 0 }}>
									<View style={styles.threadTop}>
										<Txt style={styles.threadName} numberOfLines={1}>
											{conversation.contactName}
										</Txt>
										<Txt style={styles.threadTime}>{rowTime(conversation.lastMessageAt)}</Txt>
									</View>
									<Txt style={styles.threadChannel}>{meta.label}</Txt>
									<Txt style={styles.threadSnippet} numberOfLines={1}>
										{conversation.snippet || 'No messages yet'}
									</Txt>
								</View>
								{conversation.status === 'needs_attention' ? (
									<Dot color={colors.red} size={8} />
								) : conversation.status === 'rivus_handling' ? (
									<GradientMark size={18} />
								) : conversation.status === 'resolved' ? (
									<Icon name="check" size={15} color={colors.textGhost} />
								) : null}
							</Pressable>
						);
					})}
				</ScrollView>
			)}
		</View>
	);
}

function FilterChip({
	label,
	active,
	dot,
	onPress,
}: {
	label: string;
	active: boolean;
	dot?: boolean;
	onPress: () => void;
}) {
	return (
		<Pressable
			onPress={onPress}
			style={[styles.filter, active && styles.filterActive]}
			accessibilityRole="button"
			accessibilityState={{ selected: active }}
		>
			{dot ? <Dot color={colors.red} size={6} /> : null}
			<Txt style={active ? styles.filterActiveTxt : styles.filterTxt}>{label}</Txt>
		</Pressable>
	);
}

/* ------------------------------ Conversation ------------------------------ */

function ConversationPane({
	conversation,
	detail,
	loading,
	error,
	busy,
	draft,
	editingDraft,
	onBack,
	onChangeDraft,
	onSend,
	onRivusReply,
	onApprove,
	onEditDraft,
}: {
	conversation: Conversation | null;
	detail: ConversationDetail | null;
	loading: boolean;
	error: string | null;
	busy: boolean;
	draft: string;
	editingDraft: boolean;
	onBack?: () => void;
	onChangeDraft: (text: string) => void;
	onSend: () => void;
	onRivusReply: () => void;
	onApprove: () => void;
	onEditDraft: () => void;
}) {
	if (!conversation) {
		return (
			<View style={[styles.convo, styles.convoEmpty]}>
				<Txt style={styles.empty}>Select a conversation to get started.</Txt>
			</View>
		);
	}

	const meta = CHANNEL_META[conversation.channel];
	const messages = detail?.messages ?? [];
	const needsAttention = conversation.status === 'needs_attention';

	return (
		<View style={styles.convo}>
			<View style={styles.convoHead}>
				{onBack ? (
					<Pressable onPress={onBack} style={styles.backBtn} accessibilityRole="button">
						<Icon name="chevron-left" size={22} color={colors.brandPurple} />
					</Pressable>
				) : null}
				<Avatar initials={initialsOf(conversation.contactName)} size={38} />
				<View style={{ flex: 1 }}>
					<Txt style={styles.convoName}>{conversation.contactName}</Txt>
					<Txt style={styles.convoSub}>
						{meta.label}
						{conversation.contactPhone ? ` · ${conversation.contactPhone}` : ''}
					</Txt>
				</View>
				{conversation.status === 'rivus_handling' ? (
					<RivusStatusChip label="Rivus is handling" />
				) : null}
			</View>

			{loading ? (
				<ActivityIndicator color={colors.brandPurple} style={styles.detailLoading} />
			) : error ? (
				<View style={styles.detailErrorWrap}>
					<Txt style={styles.errorTxt}>{error}</Txt>
				</View>
			) : (
				<ScrollView contentContainerStyle={styles.convoScroll}>
					<Txt style={styles.dayDivider}>{dayLabel(conversation.lastMessageAt)}</Txt>
					{messages.map((message) => (
						<MessageRow
							key={message.id}
							message={message}
							contactInitials={initialsOf(conversation.contactName)}
						/>
					))}
				</ScrollView>
			)}

			{needsAttention ? (
				<View style={styles.approve}>
					<Txt style={styles.approveTxt}>
						<Txt style={styles.approveBold}>Rivus paused for you.</Txt>{' '}
						{conversation.flagReason || 'This thread is waiting for your review.'}
					</Txt>
					<Pressable style={styles.editBtn} onPress={onEditDraft} disabled={busy}>
						<Txt style={styles.editBtnTxt}>Edit</Txt>
					</Pressable>
					<Pressable onPress={onApprove} disabled={busy || !conversation.pendingReply}>
						<BrandGradient style={styles.approveBtn}>
							<Txt style={styles.approveBtnTxt}>Approve &amp; send</Txt>
						</BrandGradient>
					</Pressable>
				</View>
			) : null}

			<View style={styles.composerWrap}>
				{!needsAttention ? (
					<Pressable
						style={styles.rivusReplyBtn}
						onPress={onRivusReply}
						disabled={busy}
						accessibilityRole="button"
					>
						<GradientMark size={15} />
						<Txt style={styles.rivusReplyTxt}>
							{busy ? 'Rivus is thinking…' : 'Let Rivus reply'}
						</Txt>
					</Pressable>
				) : null}
				<View style={styles.composer}>
					{/* A multiline TextInput's Enter inserts a newline (it never fires
					    onSubmitEditing), so sending is via the button — no dead submit handler. */}
					<TextInput
						style={styles.composerInput}
						value={draft}
						onChangeText={onChangeDraft}
						placeholder={editingDraft ? 'Edit Rivus’s reply…' : 'Type a message…'}
						placeholderTextColor={colors.textGhost}
						multiline
					/>
					<Pressable onPress={onSend} disabled={busy || draft.trim() === ''}>
						<BrandGradient style={styles.sendBtn}>
							<Icon name="arrow-right" size={17} color="#fff" />
						</BrandGradient>
					</Pressable>
				</View>
			</View>
		</View>
	);
}

function MessageRow({ message, contactInitials }: { message: Message; contactInitials: string }) {
	if (message.author === 'note') {
		return (
			<View style={styles.noteWrap}>
				<View style={styles.note}>
					<GradientMark size={16} />
					<Txt style={styles.noteTxt}>{message.body}</Txt>
				</View>
			</View>
		);
	}
	const isCustomer = message.author === 'customer';
	const isRivus = message.author === 'rivus';
	return (
		<View style={[styles.msgRow, isCustomer ? styles.msgRowStart : styles.msgRowEnd]}>
			{isCustomer ? <Avatar initials={contactInitials} size={30} /> : null}
			<View style={[styles.bubbleCol, !isCustomer && styles.bubbleColEnd]}>
				<View style={[styles.bubble, isCustomer ? styles.bubbleCust : styles.bubbleRivus]}>
					<Txt style={[styles.bubbleTxt, !isCustomer && styles.bubbleTxtRivus]}>{message.body}</Txt>
				</View>
				<Txt style={styles.bubbleTime}>{clockTime(message.createdAt)}</Txt>
			</View>
			{isRivus ? <RivusBadge size={30} radius={8} /> : null}
			{/* A human teammate's reply: a neutral team avatar, never the viewer's own —
			    messages carry no sender identity, so the viewer's initials would misattribute. */}
			{message.author === 'agent' ? (
				<View style={styles.agentAvatar}>
					<Icon name="user" size={15} color={colors.textMuted} />
				</View>
			) : null}
		</View>
	);
}

/* -------------------------------- Context --------------------------------- */

function Context({
	conversation,
	customer,
}: {
	conversation: Conversation | null;
	customer: Customer | null;
}) {
	if (!conversation) {
		return <View style={styles.context} />;
	}
	const phone = conversation.contactPhone || customer?.phone || '';
	const since = customer ? new Date(customer.createdAt).getFullYear() : null;
	const showBilling = customer !== null || conversation.lastInvoice !== '';

	return (
		<ScrollView style={styles.context} contentContainerStyle={styles.contextScroll}>
			<View style={styles.contextHead}>
				<Avatar initials={initialsOf(conversation.contactName)} size={58} />
				<Txt style={styles.contextName}>{conversation.contactName}</Txt>
				{customer?.address ? <Txt style={styles.contextArea}>{customer.address}</Txt> : null}
				{conversation.tags.length > 0 ? (
					<View style={styles.tags}>
						{conversation.tags.map((tag) => (
							<Pill
								key={tag}
								label={tag}
								color={colors.brandPurple}
								background={colors.purpleTint}
							/>
						))}
					</View>
				) : null}
			</View>

			<View style={styles.contextBlock}>
				{phone ? <InfoRow label="Phone" value={phone} /> : null}
				{since ? <InfoRow label="Customer since" value={String(since)} /> : null}
				{customer ? (
					<InfoRow label="Lifetime value" value={formatMoney(customer.lifetimeValue)} bold last />
				) : null}
			</View>

			{showBilling ? (
				<View style={styles.contextPad}>
					<View style={styles.qbHead}>
						<Icon name="credit-card" size={16} color={colors.green} />
						<Txt style={styles.qbTitle}>QuickBooks billing</Txt>
					</View>
					<View style={styles.qbCard}>
						<View style={styles.qbRow}>
							<Txt style={styles.contextLabel}>Balance due</Txt>
							<Txt style={styles.qbBalance}>{formatMoney(customer?.balance ?? 0)}</Txt>
						</View>
						{conversation.lastInvoice ? (
							<View style={styles.qbInvoice}>
								<Txt style={styles.contextLabel}>Last invoice</Txt>
								<Txt style={styles.qbInvoiceTxt}>{conversation.lastInvoice}</Txt>
							</View>
						) : null}
					</View>
					<Txt style={styles.qbNote}>
						Rivus can answer account &amp; balance questions for this customer directly from
						QuickBooks.
					</Txt>
				</View>
			) : null}
		</ScrollView>
	);
}

function InfoRow({
	label,
	value,
	bold,
	last,
}: {
	label: string;
	value: string;
	bold?: boolean;
	last?: boolean;
}) {
	return (
		<View style={[styles.infoRow, !last && styles.infoRowGap]}>
			<Txt style={styles.contextLabel}>{label}</Txt>
			<Txt style={[styles.infoValue, bold && styles.infoValueBold]}>{value}</Txt>
		</View>
	);
}

const styles = StyleSheet.create({
	row: { flex: 1, flexDirection: 'row' },
	rowNarrow: { flex: 1 },

	// List
	list: {
		width: 340,
		borderRightWidth: 1,
		borderRightColor: colors.border,
		backgroundColor: colors.surfaceAlt,
	},
	listFull: { width: '100%', flex: 1, borderRightWidth: 0 },
	listHead: {
		paddingHorizontal: 18,
		paddingTop: 18,
		paddingBottom: 12,
		borderBottomWidth: 1,
		borderBottomColor: colors.borderSoft,
	},
	listTitle: { fontFamily: font.semibold, fontSize: 18, marginBottom: 13 },
	filters: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
	filter: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 6,
		paddingVertical: 5,
		paddingHorizontal: 12,
		borderRadius: radii.pill,
		backgroundColor: colors.borderSoft,
	},
	filterActive: { backgroundColor: colors.text },
	filterActiveTxt: { fontFamily: font.semibold, fontSize: 12, color: '#fff' },
	filterTxt: { fontFamily: font.medium, fontSize: 12, color: colors.textSub },
	listScroll: { padding: 8, gap: 3 },
	listLoading: { paddingVertical: 28 },
	threadRow: {
		flexDirection: 'row',
		gap: 12,
		padding: 12,
		borderRadius: radii.xl,
		borderWidth: 1,
		borderColor: 'transparent',
	},
	threadRowActive: {
		backgroundColor: colors.surface,
		borderColor: '#e4e6ee',
	},
	chDot: {
		position: 'absolute',
		bottom: -1,
		right: -1,
		width: 13,
		height: 13,
		borderRadius: 7,
		borderWidth: 2,
		borderColor: colors.surfaceAlt,
	},
	threadTop: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: 8,
	},
	threadName: { fontFamily: font.semibold, fontSize: 13.5, flex: 1 },
	threadTime: { fontFamily: font.regular, fontSize: 11, color: colors.textGhost },
	threadChannel: {
		fontFamily: font.regular,
		fontSize: 12,
		color: colors.textFaint,
		marginVertical: 2,
	},
	threadSnippet: { fontFamily: font.regular, fontSize: 12.5, color: colors.textBody },

	// Conversation
	convo: { flex: 1, minWidth: 0, backgroundColor: colors.surface },
	convoEmpty: { alignItems: 'center', justifyContent: 'center' },
	convoHead: {
		height: 66,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 13,
		paddingHorizontal: 22,
		borderBottomWidth: 1,
		borderBottomColor: colors.borderSoft,
	},
	backBtn: { width: 30, alignItems: 'center', justifyContent: 'center' },
	convoName: { fontFamily: font.semibold, fontSize: 15 },
	convoSub: { fontFamily: font.regular, fontSize: 12, color: colors.textMuted },
	convoScroll: { padding: 22, paddingTop: 18 },
	detailLoading: { paddingVertical: 40 },
	dayDivider: {
		textAlign: 'center',
		fontFamily: font.regular,
		fontSize: 11,
		color: colors.textGhost,
		marginBottom: 18,
	},

	noteWrap: { alignItems: 'center', marginVertical: 14 },
	note: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 9,
		backgroundColor: '#faf8fe',
		borderWidth: 1,
		borderColor: '#ece4f6',
		borderRadius: radii.pill,
		paddingVertical: 7,
		paddingHorizontal: 15,
		maxWidth: '92%',
	},
	noteTxt: { fontFamily: font.medium, fontSize: 12, color: '#6b5b85', flexShrink: 1 },

	msgRow: { flexDirection: 'row', gap: 10, marginVertical: 12, alignItems: 'flex-end' },
	msgRowStart: { justifyContent: 'flex-start' },
	msgRowEnd: { justifyContent: 'flex-end' },
	agentAvatar: {
		width: 30,
		height: 30,
		borderRadius: 15,
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: colors.avatarBg,
	},
	bubbleCol: { gap: 4, maxWidth: '78%', alignItems: 'flex-start' },
	bubbleColEnd: { alignItems: 'flex-end' },
	bubble: { paddingVertical: 11, paddingHorizontal: 14 },
	bubbleCust: {
		backgroundColor: '#f1f2f7',
		borderTopLeftRadius: 14,
		borderTopRightRadius: 14,
		borderBottomRightRadius: 14,
		borderBottomLeftRadius: 4,
	},
	bubbleRivus: {
		backgroundColor: 'rgba(110,30,200,0.06)',
		borderWidth: 1,
		borderColor: 'rgba(110,30,200,0.16)',
		borderTopLeftRadius: 14,
		borderTopRightRadius: 14,
		borderBottomRightRadius: 4,
		borderBottomLeftRadius: 14,
	},
	bubbleTxt: { fontFamily: font.regular, fontSize: 13.5, color: '#2a2b36', lineHeight: 20 },
	bubbleTxtRivus: { color: '#23202e' },
	bubbleTime: {
		fontFamily: font.regular,
		fontSize: 10.5,
		color: colors.textHint,
		paddingHorizontal: 4,
	},

	// Approve banner
	approve: {
		marginHorizontal: 22,
		marginBottom: 14,
		backgroundColor: '#fdf7f6',
		borderWidth: 1,
		borderColor: '#f0e3e1',
		borderRadius: radii.xl,
		padding: 13,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		flexWrap: 'wrap',
	},
	approveTxt: {
		fontFamily: font.regular,
		fontSize: 12.5,
		color: '#9a5246',
		flex: 1,
		minWidth: 200,
		lineHeight: 18,
	},
	approveBold: { fontFamily: font.semibold },
	editBtn: {
		backgroundColor: colors.surface,
		borderWidth: 1,
		borderColor: '#e3d2cf',
		paddingVertical: 8,
		paddingHorizontal: 13,
		borderRadius: 9,
	},
	editBtnTxt: { fontFamily: font.semibold, fontSize: 12.5, color: '#9a5246' },
	approveBtn: { paddingVertical: 8, paddingHorizontal: 15, borderRadius: 9 },
	approveBtnTxt: { fontFamily: font.semibold, fontSize: 12.5, color: '#fff' },

	// Composer
	composerWrap: {
		borderTopWidth: 1,
		borderTopColor: colors.borderSoft,
		paddingVertical: 14,
		paddingHorizontal: 22,
		gap: 10,
	},
	rivusReplyBtn: {
		flexDirection: 'row',
		alignItems: 'center',
		alignSelf: 'flex-start',
		gap: 8,
		paddingVertical: 6,
		paddingHorizontal: 12,
		borderRadius: radii.pill,
		backgroundColor: '#faf8fe',
		borderWidth: 1,
		borderColor: '#ece4f6',
	},
	rivusReplyTxt: { fontFamily: font.semibold, fontSize: 12.5, color: colors.brandPurple },
	composer: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		backgroundColor: colors.fieldSoft,
		borderWidth: 1,
		borderColor: colors.borderField,
		borderRadius: radii.xl,
		paddingVertical: 12,
		paddingHorizontal: 16,
	},
	composerInput: {
		flex: 1,
		fontFamily: font.regular,
		fontSize: 13.5,
		color: colors.text,
		maxHeight: 120,
		padding: 0,
	},
	sendBtn: {
		width: 34,
		height: 34,
		borderRadius: 9,
		alignItems: 'center',
		justifyContent: 'center',
	},

	// Context
	context: {
		width: 300,
		flexGrow: 0,
		flexShrink: 0,
		borderLeftWidth: 1,
		borderLeftColor: colors.border,
		backgroundColor: colors.surfaceAlt,
	},
	contextScroll: { paddingVertical: 22, paddingHorizontal: 20 },
	contextHead: {
		alignItems: 'center',
		paddingBottom: 18,
		borderBottomWidth: 1,
		borderBottomColor: colors.borderSoft,
	},
	contextName: { fontFamily: font.semibold, fontSize: 16, marginTop: 11 },
	contextArea: { fontFamily: font.regular, fontSize: 12.5, color: colors.textMuted, marginTop: 3 },
	tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 12 },
	contextBlock: {
		paddingVertical: 18,
		borderBottomWidth: 1,
		borderBottomColor: colors.borderSoft,
	},
	infoRow: { flexDirection: 'row', justifyContent: 'space-between' },
	infoRowGap: { marginBottom: 11 },
	contextLabel: { fontFamily: font.regular, fontSize: 12.5, color: colors.textMuted },
	infoValue: { fontFamily: font.medium, fontSize: 12.5 },
	infoValueBold: { fontFamily: font.semibold },
	contextPad: { paddingTop: 18 },
	qbHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 13 },
	qbTitle: { fontFamily: font.semibold, fontSize: 12.5 },
	qbCard: {
		backgroundColor: colors.surface,
		borderWidth: 1,
		borderColor: '#eaecf2',
		borderRadius: radii.lg,
		padding: 14,
	},
	qbRow: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		marginBottom: 10,
	},
	qbBalance: { fontFamily: font.semibold, fontSize: 15 },
	qbInvoice: { borderTopWidth: 1, borderTopColor: '#f0f1f5', paddingTop: 10 },
	qbInvoiceTxt: { fontFamily: font.medium, fontSize: 12, color: '#3a3b48', marginTop: 2 },
	qbNote: {
		fontFamily: font.regular,
		fontSize: 11.5,
		color: colors.textFaint,
		marginTop: 11,
		lineHeight: 17,
	},

	// States
	errorTxt: {
		fontFamily: font.medium,
		fontSize: 12.5,
		color: colors.redInk,
		padding: 18,
	},
	detailErrorWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
	empty: {
		fontFamily: font.regular,
		fontSize: 13,
		color: colors.textMuted,
		padding: 18,
		textAlign: 'center',
	},
});

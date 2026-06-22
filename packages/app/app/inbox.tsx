import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
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
import { channelColor, type Message, threads } from '@/src/data/demo';
import { colors, font, radii } from '@/src/theme/tokens';

export default function InboxScreen() {
	const { width } = useWindowDimensions();
	const wide = width >= 760;
	const showContext = width >= 1080;

	const [idx, setIdx] = useState(0);
	const [detail, setDetail] = useState(false);
	const sel = threads[idx];

	const pick = (i: number) => {
		setIdx(i);
		setDetail(true);
	};

	if (wide) {
		return (
			<View style={styles.row}>
				<ThreadList idx={idx} onPick={(i) => setIdx(i)} />
				<Conversation sel={sel} />
				{showContext ? <Context sel={sel} /> : null}
			</View>
		);
	}

	return (
		<View style={styles.rowNarrow}>
			{detail ? (
				<Conversation sel={sel} onBack={() => setDetail(false)} />
			) : (
				<ThreadList idx={idx} onPick={pick} full />
			)}
		</View>
	);
}

/* ------------------------------ Thread list ------------------------------- */

function ThreadList({
	idx,
	onPick,
	full,
}: {
	idx: number;
	onPick: (i: number) => void;
	full?: boolean;
}) {
	return (
		<View style={[styles.list, full && styles.listFull]}>
			<View style={styles.listHead}>
				<Txt style={styles.listTitle}>Inbox</Txt>
				<View style={styles.filters}>
					<View style={[styles.filter, styles.filterActive]}>
						<Txt style={styles.filterActiveTxt}>All</Txt>
					</View>
					<View style={styles.filter}>
						<Dot color={colors.red} size={6} />
						<Txt style={styles.filterTxt}>Needs you · 2</Txt>
					</View>
					<View style={styles.filter}>
						<Txt style={styles.filterTxt}>Rivus</Txt>
					</View>
				</View>
			</View>
			<ScrollView contentContainerStyle={styles.listScroll}>
				{threads.map((t, i) => {
					const active = i === idx;
					return (
						<Pressable
							key={t.name}
							onPress={() => onPick(i)}
							style={[styles.threadRow, active && styles.threadRowActive]}
						>
							<View>
								<Avatar initials={t.initials} size={40} />
								<View style={[styles.chDot, { backgroundColor: channelColor[t.channel] }]} />
							</View>
							<View style={{ flex: 1, minWidth: 0 }}>
								<View style={styles.threadTop}>
									<Txt style={styles.threadName} numberOfLines={1}>
										{t.name}
									</Txt>
									<Txt style={styles.threadTime}>{t.time}</Txt>
								</View>
								<Txt style={styles.threadChannel}>{t.channel}</Txt>
								<Txt style={styles.threadSnippet} numberOfLines={1}>
									{t.snippet}
								</Txt>
							</View>
							{t.status === 'needs' ? <Dot color={colors.red} size={8} /> : null}
							{t.status === 'rivus' ? <GradientMark size={18} /> : null}
						</Pressable>
					);
				})}
			</ScrollView>
		</View>
	);
}

/* ------------------------------ Conversation ------------------------------ */

function Conversation({ sel, onBack }: { sel: (typeof threads)[number]; onBack?: () => void }) {
	return (
		<View style={styles.convo}>
			<View style={styles.convoHead}>
				{onBack ? (
					<Pressable onPress={onBack} style={styles.backBtn}>
						<Icon name="chevron-left" size={22} color={colors.brandPurple} />
					</Pressable>
				) : null}
				<Avatar initials={sel.initials} size={38} />
				<View style={{ flex: 1 }}>
					<Txt style={styles.convoName}>{sel.name}</Txt>
					<Txt style={styles.convoSub}>
						{sel.channel} · {sel.phone}
					</Txt>
				</View>
				<RivusStatusChip label="Rivus is handling" />
				<Pressable style={styles.moreBtn}>
					<Icon name="more-horizontal" size={18} color={colors.textSub} />
				</Pressable>
			</View>

			<ScrollView contentContainerStyle={styles.convoScroll}>
				<Txt style={styles.dayDivider}>Today</Txt>
				{sel.messages.map((m) => (
					<MessageRow key={`${m.f}-${m.t}`} m={m} initials={sel.initials} />
				))}
			</ScrollView>

			{sel.status === 'needs' ? (
				<View style={styles.approve}>
					<Txt style={styles.approveTxt}>
						<Txt style={styles.approveBold}>Rivus paused for you.</Txt> This reply touches a billing
						dispute — approve it or edit before it sends.
					</Txt>
					<Pressable style={styles.editBtn}>
						<Txt style={styles.editBtnTxt}>Edit</Txt>
					</Pressable>
					<Pressable>
						<BrandGradient style={styles.approveBtn}>
							<Txt style={styles.approveBtnTxt}>Approve &amp; send</Txt>
						</BrandGradient>
					</Pressable>
				</View>
			) : null}

			<View style={styles.composerWrap}>
				<View style={styles.composer}>
					<Txt style={styles.composerTxt}>Type a message, or let Rivus reply…</Txt>
					<Pressable>
						<BrandGradient style={styles.sendBtn}>
							<Icon name="arrow-right" size={17} color="#fff" />
						</BrandGradient>
					</Pressable>
				</View>
			</View>
		</View>
	);
}

function MessageRow({ m, initials }: { m: Message; initials: string }) {
	if (m.f === 'note') {
		return (
			<View style={styles.noteWrap}>
				<View style={styles.note}>
					<GradientMark size={16} />
					<Txt style={styles.noteTxt}>{m.t}</Txt>
				</View>
			</View>
		);
	}
	const isRivus = m.f === 'rivus';
	return (
		<View style={[styles.msgRow, isRivus ? styles.msgRowEnd : styles.msgRowStart]}>
			{!isRivus ? <Avatar initials={initials} size={30} /> : null}
			<View style={[styles.bubbleCol, isRivus && styles.bubbleColEnd]}>
				<View style={[styles.bubble, isRivus ? styles.bubbleRivus : styles.bubbleCust]}>
					<Txt style={[styles.bubbleTxt, isRivus && styles.bubbleTxtRivus]}>{m.t}</Txt>
				</View>
				<Txt style={styles.bubbleTime}>{m.time}</Txt>
			</View>
			{isRivus ? <RivusBadge size={30} radius={8} /> : null}
		</View>
	);
}

/* -------------------------------- Context --------------------------------- */

function Context({ sel }: { sel: (typeof threads)[number] }) {
	return (
		<ScrollView style={styles.context} contentContainerStyle={styles.contextScroll}>
			<View style={styles.contextHead}>
				<Avatar initials={sel.initials} size={58} />
				<Txt style={styles.contextName}>{sel.name}</Txt>
				<Txt style={styles.contextArea}>{sel.area}</Txt>
				<View style={styles.tags}>
					{sel.tags.map((tag) => (
						<Pill key={tag} label={tag} color={colors.brandPurple} background={colors.purpleTint} />
					))}
				</View>
			</View>

			<View style={styles.contextBlock}>
				<InfoRow label="Phone" value={sel.phone} />
				<InfoRow label="Customer since" value={sel.since} />
				<InfoRow label="Lifetime value" value={sel.ltv} bold last />
			</View>

			<View style={styles.contextPad}>
				<View style={styles.qbHead}>
					<Icon name="credit-card" size={16} color={colors.green} />
					<Txt style={styles.qbTitle}>QuickBooks billing</Txt>
				</View>
				<View style={styles.qbCard}>
					<View style={styles.qbRow}>
						<Txt style={styles.contextLabel}>Balance due</Txt>
						<Txt style={styles.qbBalance}>{sel.balance}</Txt>
					</View>
					<View style={styles.qbInvoice}>
						<Txt style={styles.contextLabel}>Last invoice</Txt>
						<Txt style={styles.qbInvoiceTxt}>{sel.invoice}</Txt>
					</View>
				</View>
				<Txt style={styles.qbNote}>
					Rivus can answer account &amp; balance questions for this customer directly from
					QuickBooks.
				</Txt>
			</View>
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
	moreBtn: {
		width: 38,
		height: 38,
		borderRadius: radii.md,
		borderWidth: 1,
		borderColor: colors.borderField,
		alignItems: 'center',
		justifyContent: 'center',
	},
	convoScroll: { padding: 22, paddingTop: 18 },
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
	},
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
	composerTxt: { flex: 1, fontFamily: font.regular, fontSize: 13.5, color: colors.textGhost },
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
});

import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { RivusSymbol } from '@/src/brand/RivusLogo';
import { BrandGradient } from '@/src/components/Gradient';
import { Avatar, GradientButton, Icon, Pill, SectionLabel, Txt } from '@/src/components/ui';
import { customerStatusStyle, customers } from '@/src/data/demo';
import { colors, font, radii, SIDEBAR_BREAKPOINT, SIDEBAR_WIDTH } from '@/src/theme/tokens';

const COLS = {
	customer: 2.2,
	area: 1.3,
	channel: 1,
	lifetime: 1,
	balance: 1.2,
	status: 1.1,
};

const recent = [
	{ color: colors.brandPurple, title: 'Emailed about invoice #1051', time: 'Today, 8:47 AM' },
	{ color: colors.brandCyan, title: 'Valve replacement completed', time: 'Jun 18' },
	{ color: '#d3d6e0', title: 'Left a 5-star review', time: 'May 30' },
];

const invoices = [
	{ title: '#1051 · Valve replacement', meta: 'Due Jun 30', tag: '$540', paid: false },
	{ title: '#1037 · Drain cleaning', meta: 'Paid May 28', tag: 'Paid', paid: true },
	{ title: '#1022 · Faucet install', meta: 'Paid Apr 11', tag: 'Paid', paid: true },
];

export default function CustomersScreen() {
	const { width } = useWindowDimensions();
	const sidebar = width >= SIDEBAR_BREAKPOINT ? SIDEBAR_WIDTH : 0;
	const showPanel = width >= 1040;
	const panel = showPanel ? 340 : 0;
	const avail = width - sidebar - panel - 48;
	const tableWidth = Math.max(620, avail);

	return (
		<View style={styles.row}>
			<ScrollView style={{ flex: 1 }} contentContainerStyle={styles.leftPad}>
				<View style={styles.head}>
					<View>
						<Txt style={styles.title}>Customers</Txt>
						<Txt style={styles.subtitle}>1,284 contacts · synced with QuickBooks</Txt>
					</View>
					<View style={styles.headActions}>
						<View style={styles.syncChip}>
							<Icon name="refresh-cw" size={15} color={colors.green} />
							<Txt style={styles.syncTxt}>QuickBooks · synced 6m ago</Txt>
						</View>
						<GradientButton label="Add customer" icon="plus" />
					</View>
				</View>

				<ScrollView horizontal showsHorizontalScrollIndicator={false}>
					<View style={[styles.table, { width: tableWidth }]}>
						<View style={styles.tableHead}>
							<Txt style={[styles.th, { flex: COLS.customer }]}>Customer</Txt>
							<Txt style={[styles.th, { flex: COLS.area }]}>Area</Txt>
							<Txt style={[styles.th, { flex: COLS.channel }]}>Channel</Txt>
							<Txt style={[styles.th, styles.right, { flex: COLS.lifetime }]}>Lifetime</Txt>
							<Txt style={[styles.th, styles.right, { flex: COLS.balance }]}>Balance</Txt>
							<Txt style={[styles.th, styles.right, { flex: COLS.status }]}>Status</Txt>
						</View>
						{customers.map((c, i) => {
							const st = customerStatusStyle[c.status];
							return (
								<View key={c.name} style={[styles.tr, i === customers.length - 1 && styles.trLast]}>
									<View style={[styles.cell, styles.customerCell, { flex: COLS.customer }]}>
										<Avatar initials={c.initials} size={36} />
										<Txt style={styles.customerName} numberOfLines={1}>
											{c.name}
										</Txt>
									</View>
									<Txt style={[styles.td, { flex: COLS.area }]}>{c.area}</Txt>
									<Txt style={[styles.td, { flex: COLS.channel }]}>{c.channel}</Txt>
									<Txt style={[styles.td, styles.right, styles.tdMed, { flex: COLS.lifetime }]}>
										{c.ltv}
									</Txt>
									<Txt style={[styles.td, styles.right, styles.tdBold, { flex: COLS.balance }]}>
										{c.balance}
									</Txt>
									<View style={[styles.cell, styles.statusCell, { flex: COLS.status }]}>
										<Pill label={st.label} color={st.color} background={st.background} />
									</View>
								</View>
							);
						})}
					</View>
				</ScrollView>
			</ScrollView>

			{showPanel ? <AccountPanel /> : null}
		</View>
	);
}

function AccountPanel() {
	return (
		<ScrollView style={styles.panel} contentContainerStyle={styles.panelPad}>
			<SectionLabel style={{ marginBottom: 14 }}>Account</SectionLabel>
			<View style={styles.acctHead}>
				<Avatar initials="PA" size={50} />
				<View style={{ flex: 1 }}>
					<Txt style={styles.acctName}>Priya Anand</Txt>
					<Txt style={styles.acctSub}>Capitol Hill · Customer since 2020</Txt>
				</View>
			</View>

			<View style={styles.billCard}>
				<View style={styles.qbHead}>
					<Icon name="credit-card" size={16} color={colors.green} />
					<Txt style={styles.qbTitle}>Billing · QuickBooks</Txt>
				</View>
				<View style={styles.balanceRow}>
					<Txt style={styles.muted}>Balance due</Txt>
					<Txt style={styles.balanceAmt}>$540.00</Txt>
				</View>
				<View style={styles.invoiceList}>
					{invoices.map((inv) => (
						<View key={inv.title} style={styles.invoiceRow}>
							<View style={{ flex: 1 }}>
								<Txt style={styles.invoiceTitle}>{inv.title}</Txt>
								<Txt style={styles.invoiceMeta}>{inv.meta}</Txt>
							</View>
							<Pill
								label={inv.tag}
								color={inv.paid ? colors.green : colors.redInk}
								background={inv.paid ? 'rgba(31,181,115,0.12)' : 'rgba(240,88,75,0.12)'}
							/>
						</View>
					))}
				</View>
			</View>

			<View style={styles.rivusNote}>
				<BrandGradient style={styles.rivusNoteMark}>
					<RivusSymbol size={16} />
				</BrandGradient>
				<Txt style={styles.rivusNoteTxt}>
					Rivus answers Priya's billing &amp; account questions automatically — payment links,
					invoice copies, and balance lookups, straight from QuickBooks.
				</Txt>
			</View>

			<SectionLabel style={{ marginTop: 22, marginBottom: 12 }}>Recent activity</SectionLabel>
			<View style={{ gap: 13 }}>
				{recent.map((r) => (
					<View key={r.title} style={styles.activityRow}>
						<View style={[styles.activityDot, { backgroundColor: r.color }]} />
						<View>
							<Txt style={styles.activityTitle}>{r.title}</Txt>
							<Txt style={styles.invoiceMeta}>{r.time}</Txt>
						</View>
					</View>
				))}
			</View>
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	row: { flex: 1, flexDirection: 'row' },
	leftPad: { padding: 24, paddingBottom: 40 },
	head: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: 16,
		flexWrap: 'wrap',
		marginBottom: 20,
	},
	title: { fontFamily: font.semibold, fontSize: 20 },
	subtitle: { fontFamily: font.regular, fontSize: 13, color: colors.textMuted, marginTop: 3 },
	headActions: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
	syncChip: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		borderWidth: 1,
		borderColor: colors.borderField,
		backgroundColor: colors.surface,
		borderRadius: 9,
		paddingVertical: 8,
		paddingHorizontal: 12,
	},
	syncTxt: { fontFamily: font.regular, fontSize: 12.5, color: colors.textSub },

	table: {
		backgroundColor: colors.surface,
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: radii.xxl,
		overflow: 'hidden',
	},
	tableHead: {
		flexDirection: 'row',
		paddingVertical: 13,
		paddingHorizontal: 18,
		borderBottomWidth: 1,
		borderBottomColor: colors.borderSoft,
		backgroundColor: colors.surfaceAlt,
	},
	th: {
		fontFamily: font.semibold,
		fontSize: 11,
		letterSpacing: 0.6,
		textTransform: 'uppercase',
		color: colors.textFaint,
	},
	right: { textAlign: 'right' },
	tr: {
		flexDirection: 'row',
		alignItems: 'center',
		paddingVertical: 13,
		paddingHorizontal: 18,
		borderBottomWidth: 1,
		borderBottomColor: colors.borderRow,
	},
	trLast: { borderBottomWidth: 0 },
	cell: { flexDirection: 'row', alignItems: 'center' },
	customerCell: { gap: 12 },
	customerName: { fontFamily: font.medium, fontSize: 13.5, flex: 1 },
	td: { fontFamily: font.regular, fontSize: 13, color: colors.textSub },
	tdMed: { fontFamily: font.medium, color: colors.text },
	tdBold: { fontFamily: font.semibold, color: colors.text },
	statusCell: { justifyContent: 'flex-end' },

	// Panel
	panel: {
		width: 340,
		flexGrow: 0,
		flexShrink: 0,
		borderLeftWidth: 1,
		borderLeftColor: colors.border,
		backgroundColor: colors.surfaceAlt,
	},
	panelPad: { paddingVertical: 24, paddingHorizontal: 22 },
	acctHead: { flexDirection: 'row', alignItems: 'center', gap: 13, marginBottom: 18 },
	acctName: { fontFamily: font.semibold, fontSize: 16 },
	acctSub: { fontFamily: font.regular, fontSize: 12.5, color: colors.textMuted },
	billCard: {
		backgroundColor: colors.surface,
		borderWidth: 1,
		borderColor: '#eaecf2',
		borderRadius: radii.xl,
		padding: 16,
		marginBottom: 14,
	},
	qbHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 13 },
	qbTitle: { fontFamily: font.semibold, fontSize: 13 },
	muted: { fontFamily: font.regular, fontSize: 12.5, color: colors.textMuted },
	balanceRow: {
		flexDirection: 'row',
		alignItems: 'baseline',
		justifyContent: 'space-between',
		marginBottom: 14,
	},
	balanceAmt: { fontFamily: font.semibold, fontSize: 22, color: colors.redInk },
	invoiceList: { borderTopWidth: 1, borderTopColor: '#f0f1f5', paddingTop: 13, gap: 9 },
	invoiceRow: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		gap: 10,
	},
	invoiceTitle: { fontFamily: font.medium, fontSize: 12.5 },
	invoiceMeta: { fontFamily: font.regular, fontSize: 11, color: colors.textFaint, marginTop: 2 },
	rivusNote: {
		flexDirection: 'row',
		gap: 11,
		backgroundColor: 'rgba(110,30,200,0.05)',
		borderWidth: 1,
		borderColor: 'rgba(110,30,200,0.14)',
		borderRadius: radii.xl,
		padding: 14,
	},
	rivusNoteMark: {
		width: 26,
		height: 26,
		borderRadius: 7,
		alignItems: 'center',
		justifyContent: 'center',
	},
	rivusNoteTxt: {
		flex: 1,
		fontFamily: font.regular,
		fontSize: 12,
		color: '#4a3b60',
		lineHeight: 18,
	},
	activityRow: { flexDirection: 'row', gap: 11 },
	activityDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
	activityTitle: { fontFamily: font.regular, fontSize: 12.5 },
});

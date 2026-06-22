import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { BrandGradient } from '@/src/components/Gradient';
import { Card, Icon, RivusStatusChip, Txt } from '@/src/components/ui';
import { colors, font, radii } from '@/src/theme/tokens';

// Height of the mini bar charts. Bars use absolute px (not %) so they render
// reliably on native, matching the pattern on the Home screen.
const BARS_H = 46;

type Ad = {
	mark: string;
	markBg: string;
	markColor: string;
	name: string;
	sub: string;
	spend: string;
	leads: string;
	cost: string;
	bars: number[];
	note: string;
};

const ads: Ad[] = [
	{
		mark: 'G',
		markBg: '#eef3fe',
		markColor: '#1a73e8',
		name: 'Google Ads',
		sub: 'Search · Local Services',
		spend: '$740',
		leads: '41',
		cost: '$18',
		bars: [40, 55, 48, 70, 60, 85, 100],
		note: 'Rivus shifted $90 to your “water heater” keywords — they convert 2.3× better.',
	},
	{
		mark: 'f',
		markBg: '#eef2fd',
		markColor: '#1877f2',
		name: 'Facebook & Instagram',
		sub: 'Awareness · Lead forms',
		spend: '$510',
		leads: '23',
		cost: '$22',
		bars: [55, 42, 65, 50, 72, 62, 88],
		note: 'New “spring tune-up” creative drafted by Rivus — waiting for your approval.',
	},
];

export default function MarketingScreen() {
	return (
		<ScrollView contentContainerStyle={styles.scroll}>
			<View style={styles.inner}>
				<View>
					<Txt style={styles.title}>Marketing</Txt>
					<Txt style={styles.subtitle}>
						Rivus runs your ads, replies to reviews, and writes your newsletter — you approve the
						big moves.
					</Txt>
				</View>

				<View style={styles.adGrid}>
					{ads.map((ad) => (
						<Card key={ad.name} style={styles.adCard}>
							<View style={styles.adHead}>
								<View style={styles.adIdent}>
									<View style={[styles.adMark, { backgroundColor: ad.markBg }]}>
										<Txt style={[styles.adMarkTxt, { color: ad.markColor }]}>{ad.mark}</Txt>
									</View>
									<View>
										<Txt style={styles.adName}>{ad.name}</Txt>
										<Txt style={styles.adSub}>{ad.sub}</Txt>
									</View>
								</View>
								<RivusStatusChip label="Rivus optimizing" />
							</View>
							<View style={styles.statsRow}>
								<Stat value={ad.spend} label="Spend · 30d" />
								<Stat value={ad.leads} label="Leads" />
								<Stat value={ad.cost} label="Cost / lead" />
							</View>
							<View style={styles.bars}>
								{ad.bars.map((h, i) => {
									const last = i === ad.bars.length - 1;
									return last ? (
										<BrandGradient
											key={`${ad.name}-${h}`}
											vertical
											style={[styles.bar, { height: Math.round((h / 100) * BARS_H) }]}
										/>
									) : (
										<View
											key={`${ad.name}-${h}`}
											style={[styles.bar, { height: Math.round((h / 100) * BARS_H) }]}
										/>
									);
								})}
							</View>
							<View style={styles.noteBox}>
								<Txt style={styles.noteTxt}>{ad.note}</Txt>
							</View>
						</Card>
					))}
				</View>

				<View style={styles.lowerGrid}>
					<Card style={styles.reviewsCard}>
						<View style={styles.cardHead}>
							<Txt style={styles.cardTitle}>Reviews</Txt>
							<View style={styles.ratingRow}>
								<Txt style={styles.ratingNum}>4.8</Txt>
								<Txt style={styles.stars}>★★★★★</Txt>
								<Txt style={styles.muted}>· 312</Txt>
							</View>
						</View>
						<View style={styles.reviewSummary}>
							<Txt style={styles.reviewSummaryTxt}>
								Rivus replied to <Txt style={styles.bold}>12 reviews</Txt> this month and requested{' '}
								<Txt style={styles.bold}>48 new ones</Txt> after completed jobs.
							</Txt>
						</View>

						<View style={[styles.review, styles.reviewBorder]}>
							<View style={styles.reviewTop}>
								<View style={styles.reviewWho}>
									<Txt style={styles.reviewName}>Grace K.</Txt>
									<Txt style={styles.starsSm}>★★★★★</Txt>
								</View>
								<Txt style={styles.reviewAgo}>2h ago</Txt>
							</View>
							<Txt style={styles.reviewBody}>
								“Fast, friendly, and fixed it right the first time. Highly recommend.”
							</Txt>
							<View style={styles.reviewAction}>
								<BrandGradient style={styles.reviewActionMark} />
								<Txt style={styles.reviewActionTxt}>
									Rivus replied · thanked Grace &amp; invited her back
								</Txt>
							</View>
						</View>

						<View style={styles.review}>
							<View style={styles.reviewTop}>
								<View style={styles.reviewWho}>
									<Txt style={styles.reviewName}>Daniel R.</Txt>
									<Txt style={styles.starsSm}>★★★★☆</Txt>
								</View>
								<Txt style={styles.reviewAgo}>1d ago</Txt>
							</View>
							<Txt style={styles.reviewBody}>
								“Great work, ran a little behind on arrival time.”
							</Txt>
							<View style={styles.reviewAction}>
								<Icon name="alert-circle" size={13} color={colors.amber} />
								<Txt style={[styles.reviewActionTxt, { color: colors.amberInk }]}>
									Rivus drafted an apology + 10% off — needs your OK
								</Txt>
							</View>
						</View>
					</Card>

					<Card style={styles.newsletterCard}>
						<View style={styles.cardHead}>
							<Txt style={styles.cardTitle}>Newsletter</Txt>
							<Txt style={styles.muted}>2,140 subscribers</Txt>
						</View>
						<View style={styles.nlDark}>
							<View style={styles.nlGlow} />
							<Txt style={styles.nlEyebrow}>Next send · drafted by Rivus</Txt>
							<Txt style={styles.nlTitle}>“Beat the summer rush — book your tune-up”</Txt>
							<Txt style={styles.nlSchedule}>Scheduled Thu, Jun 25 · 9:00 AM</Txt>
						</View>
						<View style={styles.nlButtons}>
							<Pressable style={styles.previewBtn}>
								<Txt style={styles.previewTxt}>Preview</Txt>
							</Pressable>
							<Pressable style={{ flex: 1 }}>
								<BrandGradient style={styles.sendBtn}>
									<Txt style={styles.sendTxt}>Approve send</Txt>
								</BrandGradient>
							</Pressable>
						</View>
						<View style={styles.nlFoot}>
							<Txt style={[styles.muted, { marginBottom: 10 }]}>Last campaign · June 4</Txt>
							<View style={styles.nlStats}>
								<Stat value="42%" label="Open rate" small />
								<Stat value="9.1%" label="Click rate" small />
								<Stat value="7" label="Jobs booked" small />
							</View>
						</View>
					</Card>
				</View>
			</View>
		</ScrollView>
	);
}

function Stat({ value, label, small }: { value: string; label: string; small?: boolean }) {
	return (
		<View style={small ? undefined : { flex: 1 }}>
			<Txt style={small ? styles.statValueSm : styles.statValue}>{value}</Txt>
			<Txt style={styles.statLabel}>{label}</Txt>
		</View>
	);
}

const styles = StyleSheet.create({
	scroll: { padding: 24, paddingBottom: 44 },
	inner: { maxWidth: 1180, width: '100%', alignSelf: 'center', gap: 18 },
	title: { fontFamily: font.semibold, fontSize: 20 },
	subtitle: { fontFamily: font.regular, fontSize: 13, color: colors.textMuted, marginTop: 3 },

	adGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
	adCard: { flexGrow: 1, flexBasis: 360, minWidth: 280 },
	adHead: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: 12,
		flexWrap: 'wrap',
		marginBottom: 18,
	},
	adIdent: { flexDirection: 'row', alignItems: 'center', gap: 11 },
	adMark: {
		width: 34,
		height: 34,
		borderRadius: 9,
		alignItems: 'center',
		justifyContent: 'center',
	},
	adMarkTxt: { fontFamily: font.bold, fontSize: 15 },
	adName: { fontFamily: font.semibold, fontSize: 14.5 },
	adSub: { fontFamily: font.regular, fontSize: 11.5, color: colors.textFaint },
	statsRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
	statValue: { fontFamily: font.semibold, fontSize: 22, letterSpacing: -0.4 },
	statValueSm: { fontFamily: font.semibold, fontSize: 18 },
	statLabel: { fontFamily: font.regular, fontSize: 11.5, color: colors.textMuted, marginTop: 2 },
	bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 5, height: BARS_H },
	bar: { flex: 1, borderRadius: 3, backgroundColor: '#e7eaf2' },
	noteBox: { backgroundColor: colors.fieldSoft, borderRadius: 9, padding: 12, marginTop: 14 },
	noteTxt: { fontFamily: font.regular, fontSize: 12, color: colors.textSub, lineHeight: 17 },

	lowerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' },
	reviewsCard: { flexGrow: 1.3, flexBasis: 360, minWidth: 300 },
	newsletterCard: { flexGrow: 1, flexBasis: 280, minWidth: 260 },
	cardHead: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		marginBottom: 16,
	},
	cardTitle: { fontFamily: font.semibold, fontSize: 15 },
	ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
	ratingNum: { fontFamily: font.semibold, fontSize: 18 },
	stars: { color: colors.amber, fontSize: 13, letterSpacing: 1 },
	muted: { fontFamily: font.regular, fontSize: 12, color: colors.textMuted },
	reviewSummary: {
		backgroundColor: 'rgba(110,30,200,0.05)',
		borderWidth: 1,
		borderColor: 'rgba(110,30,200,0.14)',
		borderRadius: radii.md,
		padding: 12,
		marginBottom: 16,
	},
	reviewSummaryTxt: { fontFamily: font.regular, fontSize: 12, color: '#4a3b60', lineHeight: 18 },
	bold: { fontFamily: font.bold },
	review: { gap: 5 },
	reviewBorder: {
		borderBottomWidth: 1,
		borderBottomColor: colors.borderRow,
		paddingBottom: 14,
		marginBottom: 14,
	},
	reviewTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
	reviewWho: { flexDirection: 'row', alignItems: 'center', gap: 8 },
	reviewName: { fontFamily: font.semibold, fontSize: 13 },
	starsSm: { color: colors.amber, fontSize: 11 },
	reviewAgo: { fontFamily: font.regular, fontSize: 11, color: colors.textGhost },
	reviewBody: { fontFamily: font.regular, fontSize: 12.5, color: colors.textSub, lineHeight: 18 },
	reviewAction: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 3 },
	reviewActionMark: { width: 15, height: 15, borderRadius: 4 },
	reviewActionTxt: { fontFamily: font.regular, fontSize: 11.5, color: '#6b5b85', flexShrink: 1 },

	nlDark: {
		backgroundColor: '#13131f',
		borderRadius: radii.xl,
		padding: 16,
		marginBottom: 14,
		overflow: 'hidden',
	},
	nlGlow: {
		position: 'absolute',
		right: -30,
		top: -40,
		width: 150,
		height: 150,
		borderRadius: 75,
		backgroundColor: 'rgba(110,30,200,0.4)',
	},
	nlEyebrow: {
		fontFamily: font.semibold,
		fontSize: 11,
		letterSpacing: 0.9,
		textTransform: 'uppercase',
		color: '#9a8fc4',
		marginBottom: 6,
	},
	nlTitle: { fontFamily: font.semibold, fontSize: 15, color: '#fff', marginBottom: 4 },
	nlSchedule: { fontFamily: font.regular, fontSize: 12, color: '#b6b1cc' },
	nlButtons: { flexDirection: 'row', gap: 9, marginBottom: 16 },
	previewBtn: {
		flex: 1,
		backgroundColor: colors.fieldSoft,
		borderWidth: 1,
		borderColor: colors.borderField,
		paddingVertical: 9,
		borderRadius: 9,
		alignItems: 'center',
	},
	previewTxt: { fontFamily: font.semibold, fontSize: 12.5, color: '#3a3b48' },
	sendBtn: { paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
	sendTxt: { fontFamily: font.semibold, fontSize: 12.5, color: '#fff' },
	nlFoot: { borderTopWidth: 1, borderTopColor: '#f0f1f5', paddingTop: 14 },
	nlStats: { flexDirection: 'row', gap: 18 },
});

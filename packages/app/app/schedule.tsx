import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { GradientMark, Icon, RivusStatusChip, Txt } from '@/src/components/ui';
import { type CalEvent, scheduleDays, scheduleHours } from '@/src/data/demo';
import { colors, font, radii, SIDEBAR_BREAKPOINT, SIDEBAR_WIDTH } from '@/src/theme/tokens';

const HOUR_H = 64;
const GUTTER = 62;

const tones: Record<
	CalEvent['tone'],
	{ bg: string; title: string; sub: string; dashed?: boolean }
> = {
	cyan: { bg: 'rgba(30,190,250,0.14)', title: '#13658a', sub: '#3a7fa0' },
	purple: { bg: 'rgba(110,30,200,0.12)', title: '#6e1ec8', sub: '#8856b8' },
	amber: { bg: 'rgba(240,160,32,0.14)', title: '#a4720f', sub: '#b08a3a' },
	red: { bg: 'rgba(240,88,75,0.12)', title: '#c1483b', sub: '#cc6357' },
	hold: { bg: '#f1f2f6', title: '#8a8b99', sub: '#a6a8b4', dashed: true },
};

export default function ScheduleScreen() {
	const { width } = useWindowDimensions();
	const sidebar = width >= SIDEBAR_BREAKPOINT ? SIDEBAR_WIDTH : 0;
	const avail = width - sidebar;
	const dayWidth = Math.max(150, (avail - GUTTER - 1) / scheduleDays.length);
	const gridHeight = scheduleHours.length * HOUR_H;

	return (
		<View style={styles.screen}>
			<View style={styles.header}>
				<View style={styles.headerLeft}>
					<Txt style={styles.title}>Schedule</Txt>
					<View style={styles.dateNav}>
						<View style={styles.navBtn}>
							<Icon name="chevron-left" size={16} color={colors.textSub} />
						</View>
						<Txt style={styles.dateLabel}>Jun 22 – 28</Txt>
						<View style={styles.navBtn}>
							<Icon name="chevron-right" size={16} color={colors.textSub} />
						</View>
					</View>
					<RivusStatusChip label="Rivus auto-scheduled 6 of 8 jobs this week" />
				</View>
				<View style={styles.headerRight}>
					<View style={styles.legend}>
						<View style={styles.legendItem}>
							<View style={[styles.legendSwatch, { backgroundColor: colors.brandCyan }]} />
							<Txt style={styles.legendTxt}>Marcus</Txt>
						</View>
						<View style={styles.legendItem}>
							<View style={[styles.legendSwatch, { backgroundColor: colors.brandPurple }]} />
							<Txt style={styles.legendTxt}>Priya</Txt>
						</View>
					</View>
					<View style={styles.toggle}>
						<Txt style={styles.toggleOff}>Day</Txt>
						<View style={styles.toggleOn}>
							<Txt style={styles.toggleOnTxt}>Week</Txt>
						</View>
						<Txt style={styles.toggleOff}>Month</Txt>
					</View>
				</View>
			</View>

			<ScrollView style={styles.gridScroll}>
				<ScrollView horizontal showsHorizontalScrollIndicator={false}>
					<View>
						{/* Day headers */}
						<View style={styles.dayHeaderRow}>
							<View style={{ width: GUTTER }} />
							{scheduleDays.map((d) => (
								<View key={d.dow} style={[styles.dayHeader, { width: dayWidth }]}>
									<Txt style={styles.dayDow}>{d.dow}</Txt>
									<Txt style={[styles.dayDate, d.today && styles.dayDateToday]}>{d.date}</Txt>
								</View>
							))}
						</View>

						{/* Grid body */}
						<View style={styles.gridBody}>
							<View style={{ width: GUTTER }}>
								{scheduleHours.map((h) => (
									<View key={h} style={styles.hourCell}>
										<Txt style={styles.hourLabel}>{h}</Txt>
									</View>
								))}
							</View>

							{scheduleDays.map((d) => (
								<View
									key={d.dow}
									style={[
										styles.dayCol,
										{ width: dayWidth, height: gridHeight },
										d.today && styles.dayColToday,
									]}
								>
									{scheduleHours.map((h) => (
										<View key={h} style={styles.gridLine} />
									))}
									{d.events.map((ev) => (
										<EventBlock key={`${d.dow}-${ev.title}`} ev={ev} />
									))}
								</View>
							))}
						</View>
					</View>
				</ScrollView>
			</ScrollView>
		</View>
	);
}

function EventBlock({ ev }: { ev: CalEvent }) {
	const tone = tones[ev.tone];
	return (
		<View
			style={[
				styles.event,
				{ top: ev.top, height: ev.height, backgroundColor: tone.bg },
				tone.dashed && styles.eventDashed,
			]}
		>
			<View style={styles.eventTitleRow}>
				<Txt style={[styles.eventTitle, { color: tone.title }]} numberOfLines={1}>
					{ev.title}
				</Txt>
				{ev.rivus ? <GradientMark size={13} radius={4} iconSize={8} /> : null}
			</View>
			<Txt style={[styles.eventSub, { color: tone.sub }]} numberOfLines={1}>
				{ev.sub}
			</Txt>
			{ev.note ? <Txt style={[styles.eventNote, { color: tone.title }]}>{ev.note}</Txt> : null}
		</View>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1 },
	header: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: 16,
		flexWrap: 'wrap',
		paddingHorizontal: 28,
		paddingTop: 22,
		paddingBottom: 16,
		borderBottomWidth: 1,
		borderBottomColor: colors.border,
		backgroundColor: colors.surface,
	},
	headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
	title: { fontFamily: font.semibold, fontSize: 20 },
	dateNav: { flexDirection: 'row', alignItems: 'center', gap: 6 },
	navBtn: {
		width: 32,
		height: 32,
		borderRadius: radii.sm,
		borderWidth: 1,
		borderColor: colors.borderField,
		alignItems: 'center',
		justifyContent: 'center',
	},
	dateLabel: { fontFamily: font.semibold, fontSize: 14, paddingHorizontal: 6 },
	headerRight: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
	legend: { flexDirection: 'row', alignItems: 'center', gap: 14 },
	legendItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
	legendSwatch: { width: 10, height: 10, borderRadius: 3 },
	legendTxt: { fontFamily: font.regular, fontSize: 12, color: colors.textSub },
	toggle: { flexDirection: 'row', backgroundColor: '#f1f2f6', borderRadius: 9, padding: 3 },
	toggleOff: {
		fontFamily: font.medium,
		fontSize: 12.5,
		color: colors.textMuted,
		paddingVertical: 5,
		paddingHorizontal: 12,
	},
	toggleOn: {
		backgroundColor: colors.surface,
		borderRadius: 7,
		paddingVertical: 5,
		paddingHorizontal: 12,
	},
	toggleOnTxt: { fontFamily: font.semibold, fontSize: 12.5, color: colors.text },

	gridScroll: { flex: 1, backgroundColor: colors.surface },
	dayHeaderRow: {
		flexDirection: 'row',
		borderBottomWidth: 1,
		borderBottomColor: colors.border,
	},
	dayHeader: {
		alignItems: 'center',
		paddingVertical: 12,
		borderLeftWidth: 1,
		borderLeftColor: '#f0f1f5',
	},
	dayDow: { fontFamily: font.semibold, fontSize: 11, color: colors.textFaint, letterSpacing: 0.5 },
	dayDate: { fontFamily: font.semibold, fontSize: 18, marginTop: 2 },
	dayDateToday: { color: colors.brandPurple },

	gridBody: { flexDirection: 'row' },
	hourCell: { height: HOUR_H },
	hourLabel: {
		position: 'absolute',
		top: -7,
		right: 10,
		fontFamily: font.regular,
		fontSize: 11,
		color: colors.textGhost,
	},
	dayCol: { borderLeftWidth: 1, borderLeftColor: '#f0f1f5' },
	dayColToday: { backgroundColor: 'rgba(110,30,200,0.018)' },
	gridLine: { height: HOUR_H, borderBottomWidth: 1, borderBottomColor: '#f0f1f5' },
	event: {
		position: 'absolute',
		left: 5,
		right: 5,
		borderRadius: radii.sm,
		paddingVertical: 7,
		paddingHorizontal: 9,
		overflow: 'hidden',
	},
	eventDashed: { borderWidth: 1, borderStyle: 'dashed', borderColor: '#d3d6e0' },
	eventTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
	eventTitle: { fontFamily: font.semibold, fontSize: 11.5, flexShrink: 1 },
	eventSub: { fontFamily: font.regular, fontSize: 10.5, marginTop: 1 },
	eventNote: { fontFamily: font.semibold, fontSize: 10, marginTop: 4 },
});

import type { JobStatus } from '@rivus/core';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { Customer, Job, Member } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { BrandGradient, BriefingGradient } from '@/src/components/Gradient';
import {
	Card,
	Dot,
	GradientButton,
	Pill,
	RivusBadge,
	SectionLabel,
	Txt,
} from '@/src/components/ui';
import { dayRange, formatClock } from '@/src/schedule/datetime';
import { colors, font, radii } from '@/src/theme/tokens';

// Categorical dot colors per assignee (cycled by member order).
const TECH_DOTS = ['#1ebefa', '#6e1ec8', '#1fb573', '#f0a020', '#f0584b', '#3b6ef0'] as const;

const STATUS_PILL: Record<JobStatus, { label: string; color: string; bg: string }> = {
	scheduled: { label: 'Scheduled', color: colors.textSub, bg: colors.chipBg },
	confirmed: { label: 'Confirmed', color: colors.green, bg: 'rgba(31,181,115,0.12)' },
	in_progress: { label: 'In progress', color: colors.brandPurple, bg: colors.purpleTint },
	completed: { label: 'Completed', color: '#157a4e', bg: 'rgba(31,181,115,0.16)' },
	canceled: { label: 'Canceled', color: colors.redInk, bg: 'rgba(240,88,75,0.12)' },
};

/** Whole-dollar money for compact dashboard sums (420000 → "$4,200"). */
function formatDollars(cents: number): string {
	const dollars = String(Math.round(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	return `$${dollars}`;
}

const bars = [
	{ h: 46, label: 'M', accent: false },
	{ h: 62, label: 'T', accent: false },
	{ h: 38, label: 'W', accent: false },
	{ h: 72, label: 'T', accent: true },
	{ h: 54, label: 'F', accent: false },
	{ h: 28, label: 'S', accent: false },
];

export default function HomeScreen() {
	const router = useRouter();
	const { session, client } = useAuth();

	const [jobs, setJobs] = useState<Job[]>([]);
	const [customers, setCustomers] = useState<Customer[]>([]);
	const [members, setMembers] = useState<Member[]>([]);
	const [loadingJobs, setLoadingJobs] = useState(true);

	const load = useCallback(
		async (isActive: () => boolean) => {
			if (!session) {
				return;
			}
			setLoadingJobs(true);
			try {
				const { from, to } = dayRange(new Date());
				const [jobPage, customerPage, roster] = await Promise.all([
					client.listJobs(session.token, { from, to, pageSize: 100 }),
					client.listCustomers(session.token, { pageSize: 100 }),
					client.listMembers(session.token),
				]);
				if (isActive()) {
					setJobs(jobPage.data);
					setCustomers(customerPage.data);
					setMembers(roster.members);
				}
			} catch {
				// The dashboard degrades gracefully — an unreachable API just leaves the
				// schedule card empty rather than blocking the whole home screen.
				if (isActive()) {
					setJobs([]);
				}
			} finally {
				if (isActive()) {
					setLoadingJobs(false);
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

	const todayRows = useMemo(() => {
		const active = jobs
			.filter((job) => job.status !== 'canceled')
			.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
		return active.map((job) => {
			const memberIndex = members.findIndex((member) => member.userId === job.assignedUserId);
			const assignee = memberIndex >= 0 ? members[memberIndex].name : '';
			const customer = customers.find((entry) => entry.id === job.customerId)?.name ?? '';
			const pill = STATUS_PILL[job.status];
			return {
				id: job.id,
				time: formatClock(job.startAt),
				dot: memberIndex >= 0 ? TECH_DOTS[memberIndex % TECH_DOTS.length] : colors.textHint,
				title: customer ? `${job.title} · ${customer}` : job.title,
				sub: [job.address, assignee].filter(Boolean).join(' · ') || 'Unassigned',
				status: pill.label,
				statusColor: pill.color,
				statusBg: pill.bg,
			};
		});
	}, [jobs, members, customers]);

	const bookedCount = todayRows.length;
	const pipeline = useMemo(
		() =>
			jobs
				.filter((job) => job.status !== 'canceled')
				.reduce((sum, job) => sum + job.estimatedValue, 0),
		[jobs],
	);

	const metrics = [
		{
			label: 'Conversations today',
			value: '38',
			delta: '+12%',
			deltaColor: colors.green,
			sub: '34 handled by Rivus',
		},
		{
			label: 'Jobs booked',
			value: String(bookedCount),
			delta: 'today',
			deltaColor: colors.textMuted,
			sub: pipeline > 0 ? `${formatDollars(pipeline)} pipeline value` : 'No value estimated yet',
		},
		{
			label: 'Avg. response time',
			value: '12s',
			delta: '',
			deltaColor: colors.textMuted,
			sub: 'Was 4h before Rivus',
		},
		{
			label: 'Open invoices',
			value: '$8,140',
			delta: '',
			deltaColor: colors.textMuted,
			sub: '5 invoices · via QuickBooks',
		},
	];

	return (
		<ScrollView contentContainerStyle={styles.scroll}>
			<View style={styles.inner}>
				{/* Heading */}
				<View style={styles.head}>
					<View>
						<SectionLabel>Monday, June 22</SectionLabel>
						<Txt style={styles.h1}>Good morning, Marcus</Txt>
					</View>
					<GradientButton label="New job" icon="plus" onPress={() => router.push('/schedule')} />
				</View>

				{/* Briefing */}
				<BriefingGradient wide style={styles.briefing}>
					<View style={styles.glow} />
					<RivusBadge size={46} />
					<View style={styles.briefingBody}>
						<Txt style={styles.briefingEyebrow}>While you were away</Txt>
						<Txt style={styles.briefingText}>
							Rivus handled <Txt style={styles.briefingBold}>38 conversations</Txt>, booked{' '}
							<Txt style={styles.briefingBold}>6 jobs</Txt>, and answered{' '}
							<Txt style={styles.briefingBold}>19 questions</Txt> from your FAQs overnight. Two
							items need a human eye.
						</Txt>
					</View>
					<Pressable style={styles.reviewBtn} onPress={() => router.push('/inbox')}>
						<Txt style={styles.reviewBtnTxt}>Review 2 items</Txt>
					</Pressable>
				</BriefingGradient>

				{/* Metrics */}
				<View style={styles.metrics}>
					{metrics.map((m) => (
						<Card key={m.label} style={styles.metricCard}>
							<Txt style={styles.metricLabel}>{m.label}</Txt>
							<View style={styles.metricValueRow}>
								<Txt style={styles.metricValue}>{m.value}</Txt>
								{m.delta ? (
									<Txt style={[styles.metricDelta, { color: m.deltaColor }]}>{m.delta}</Txt>
								) : null}
							</View>
							<Txt style={styles.metricSub}>{m.sub}</Txt>
						</Card>
					))}
				</View>

				{/* Two columns */}
				<View style={styles.columns}>
					<View style={styles.colLeft}>
						<Card>
							<View style={styles.cardHead}>
								<Txt style={styles.cardTitle}>Today's schedule</Txt>
								<Pressable onPress={() => router.push('/schedule')}>
									<Txt style={styles.link}>View calendar</Txt>
								</Pressable>
							</View>
							<View>
								{loadingJobs ? (
									<ActivityIndicator color={colors.brandPurple} style={styles.schedLoading} />
								) : todayRows.length === 0 ? (
									<Txt style={styles.schedEmpty}>
										No jobs scheduled today. Tap “New job” to book one.
									</Txt>
								) : (
									todayRows.map((row) => (
										<Pressable
											key={row.id}
											style={styles.schedRow}
											onPress={() => router.push('/schedule')}
										>
											<Txt style={styles.schedTime}>{row.time}</Txt>
											<Dot color={row.dot} />
											<View style={{ flex: 1 }}>
												<Txt style={styles.schedTitle} numberOfLines={1}>
													{row.title}
												</Txt>
												<Txt style={styles.schedSub} numberOfLines={1}>
													{row.sub}
												</Txt>
											</View>
											<Pill label={row.status} color={row.statusColor} background={row.statusBg} />
										</Pressable>
									))
								)}
							</View>
						</Card>

						<Card>
							<View style={styles.cardHeadTight}>
								<Dot color={colors.red} size={7} />
								<Txt style={styles.cardTitle}>Needs your attention</Txt>
							</View>
							<View style={{ gap: 10 }}>
								<Pressable
									style={[styles.alert, styles.alertRed]}
									onPress={() => router.push('/inbox')}
								>
									<View style={[styles.alertMark, { backgroundColor: '#fce8e6' }]}>
										<Txt style={[styles.alertMarkTxt, { color: '#d2503f' }]}>PA</Txt>
									</View>
									<View style={{ flex: 1 }}>
										<Txt style={styles.alertTitle}>Billing question · Priya Anand</Txt>
										<Txt style={styles.alertBody}>
											Disputes $60 on invoice #1051 — Rivus drafted a reply, needs your OK.
										</Txt>
									</View>
									<Txt style={styles.alertTime}>8:47 AM</Txt>
								</Pressable>
								<Pressable
									style={[styles.alert, styles.alertPurple]}
									onPress={() => router.push('/schedule')}
								>
									<View style={[styles.alertMark, { backgroundColor: '#efe6f8' }]}>
										<Txt style={[styles.alertMarkTxt, { color: '#6e1ec8' }]}>$</Txt>
									</View>
									<View style={{ flex: 1 }}>
										<Txt style={styles.alertTitle}>Quote over $2,000 · Robert Vance</Txt>
										<Txt style={styles.alertBody}>
											Sewer line replacement — Rivus needs your approval before sending the
											estimate.
										</Txt>
									</View>
									<Txt style={styles.alertTime}>7:55 AM</Txt>
								</Pressable>
							</View>
						</Card>
					</View>

					<View style={styles.colRight}>
						<Card>
							<Txt style={[styles.cardTitle, { marginBottom: 16 }]}>Jobs this week</Txt>
							<View style={styles.chart}>
								{bars.map((b) => (
									<View key={`${b.label}-${b.h}`} style={styles.barCol}>
										{b.accent ? (
											<BrandGradient
												vertical
												style={[styles.bar, styles.barAccent, { height: b.h }]}
											/>
										) : (
											<View style={[styles.bar, { height: b.h }]} />
										)}
										<Txt style={[styles.barLabel, b.accent && styles.barLabelAccent]}>
											{b.label}
										</Txt>
									</View>
								))}
							</View>
							<View style={styles.chartFoot}>
								<Txt style={styles.metricSub}>28 jobs booked</Txt>
								<Txt style={[styles.metricSub, { color: colors.green, fontFamily: font.semibold }]}>
									+18% vs last week
								</Txt>
							</View>
						</Card>

						<Card>
							<View style={styles.cardHead}>
								<Txt style={styles.cardTitle}>Reviews</Txt>
								<Pressable onPress={() => router.push('/marketing')}>
									<Txt style={styles.link}>Manage</Txt>
								</Pressable>
							</View>
							<View style={styles.reviewRow}>
								<Txt style={styles.reviewScore}>4.8</Txt>
								<View>
									<Txt style={styles.stars}>★★★★★</Txt>
									<Txt style={styles.metricSub}>312 reviews · 3 new today</Txt>
								</View>
							</View>
							<View style={styles.reviewNote}>
								<Txt style={styles.reviewNoteTxt}>
									Rivus replied to all 3 new reviews and requested 14 new ones this week.
								</Txt>
							</View>
						</Card>

						<Card>
							<View style={styles.cardHead}>
								<Txt style={styles.cardTitle}>Marketing</Txt>
								<Pressable onPress={() => router.push('/marketing')}>
									<Txt style={styles.link}>Open</Txt>
								</Pressable>
							</View>
							<View style={{ gap: 11 }}>
								<View style={styles.mkRow}>
									<Txt style={styles.mkLabel}>Google Ads · 41 leads</Txt>
									<Txt style={styles.mkValue}>$18 / lead</Txt>
								</View>
								<View style={styles.mkRow}>
									<Txt style={styles.mkLabel}>Facebook Ads · 23 leads</Txt>
									<Txt style={styles.mkValue}>$22 / lead</Txt>
								</View>
								<View style={[styles.mkRow, styles.mkRowTop]}>
									<Txt style={styles.mkLabel}>June newsletter</Txt>
									<Pill
										label="Drafted · review"
										color={colors.brandPurple}
										background={colors.purpleTint}
									/>
								</View>
							</View>
						</Card>
					</View>
				</View>
			</View>
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	scroll: { padding: 28, paddingBottom: 40 },
	inner: { maxWidth: 1180, width: '100%', alignSelf: 'center', gap: 22 },
	head: {
		flexDirection: 'row',
		alignItems: 'flex-end',
		justifyContent: 'space-between',
		gap: 20,
		flexWrap: 'wrap',
	},
	h1: { fontFamily: font.semibold, fontSize: 26, letterSpacing: -0.5, marginTop: 5 },

	// Briefing
	briefing: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 20,
		borderRadius: radii.card,
		padding: 22,
		overflow: 'hidden',
	},
	glow: {
		position: 'absolute',
		right: -40,
		top: -60,
		width: 240,
		height: 240,
		borderRadius: 120,
		backgroundColor: 'rgba(110,30,200,0.22)',
	},
	briefingBody: { flex: 1, minWidth: 220 },
	briefingEyebrow: {
		fontFamily: font.semibold,
		fontSize: 11,
		letterSpacing: 1.1,
		textTransform: 'uppercase',
		color: '#9a8fc4',
		marginBottom: 4,
	},
	briefingText: { fontFamily: font.regular, fontSize: 16, color: '#f3f1fb', lineHeight: 24 },
	briefingBold: { fontFamily: font.bold, color: '#fff' },
	reviewBtn: {
		backgroundColor: 'rgba(255,255,255,0.1)',
		borderWidth: 1,
		borderColor: 'rgba(255,255,255,0.16)',
		paddingVertical: 10,
		paddingHorizontal: 16,
		borderRadius: radii.md,
	},
	reviewBtnTxt: { fontFamily: font.semibold, fontSize: 13, color: '#fff' },

	// Metrics
	metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
	metricCard: { flexGrow: 1, flexBasis: 180, minWidth: 160, padding: 18 },
	metricLabel: {
		fontFamily: font.semibold,
		fontSize: 12,
		color: colors.textMuted,
		marginBottom: 12,
	},
	metricValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
	metricValue: { fontFamily: font.semibold, fontSize: 30, letterSpacing: -0.6 },
	metricDelta: { fontFamily: font.semibold, fontSize: 12 },
	metricSub: { fontFamily: font.regular, fontSize: 12, color: colors.textMuted, marginTop: 6 },

	// Columns
	columns: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' },
	colLeft: { flexGrow: 1, flexBasis: 420, minWidth: 300, gap: 18 },
	colRight: { flexGrow: 1, flexBasis: 300, minWidth: 280, gap: 18 },

	cardHead: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		marginBottom: 16,
	},
	cardHeadTight: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 14 },
	cardTitle: { fontFamily: font.semibold, fontSize: 15 },
	link: { fontFamily: font.semibold, fontSize: 12.5, color: colors.brandPurple },

	schedRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 14,
		paddingVertical: 11,
		paddingHorizontal: 8,
		borderRadius: radii.md,
	},
	schedTime: { width: 68, fontFamily: font.semibold, fontSize: 12.5, color: '#3a3b48' },
	schedTitle: { fontFamily: font.medium, fontSize: 13.5 },
	schedSub: { fontFamily: font.regular, fontSize: 12, color: colors.textMuted },
	schedLoading: { paddingVertical: 20 },
	schedEmpty: {
		fontFamily: font.regular,
		fontSize: 12.5,
		color: colors.textMuted,
		paddingVertical: 16,
		paddingHorizontal: 8,
	},

	alert: { flexDirection: 'row', gap: 13, padding: 13, borderRadius: radii.lg, borderWidth: 1 },
	alertRed: { borderColor: '#f0e3e1', backgroundColor: '#fdf7f6' },
	alertPurple: { borderColor: '#ece4f4', backgroundColor: '#faf7fd' },
	alertMark: {
		width: 34,
		height: 34,
		borderRadius: 9,
		alignItems: 'center',
		justifyContent: 'center',
	},
	alertMarkTxt: { fontFamily: font.semibold, fontSize: 13 },
	alertTitle: { fontFamily: font.semibold, fontSize: 13.5 },
	alertBody: {
		fontFamily: font.regular,
		fontSize: 12.5,
		color: '#76727a',
		marginTop: 2,
		lineHeight: 18,
	},
	alertTime: {
		fontFamily: font.regular,
		fontSize: 11,
		color: colors.textHint,
		alignSelf: 'center',
	},

	// Chart
	chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, height: 96 },
	barCol: { flex: 1, alignItems: 'center', gap: 7 },
	bar: {
		width: '100%',
		borderTopLeftRadius: 6,
		borderTopRightRadius: 6,
		backgroundColor: '#e7eaf2',
	},
	barAccent: { backgroundColor: 'transparent' },
	barLabel: { fontFamily: font.regular, fontSize: 11, color: colors.textFaint },
	barLabelAccent: { fontFamily: font.semibold, color: '#3a3b48' },
	chartFoot: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		marginTop: 14,
		paddingTop: 14,
		borderTopWidth: 1,
		borderTopColor: '#f0f1f5',
	},

	// Reviews
	reviewRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 12 },
	reviewScore: { fontFamily: font.semibold, fontSize: 32, letterSpacing: -0.6 },
	stars: { color: colors.amber, fontSize: 14, letterSpacing: 2 },
	reviewNote: { backgroundColor: colors.fieldSoft, borderRadius: 9, padding: 12 },
	reviewNoteTxt: {
		fontFamily: font.regular,
		fontSize: 12.5,
		color: colors.textSub,
		lineHeight: 18,
	},

	// Marketing
	mkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
	mkRowTop: { borderTopWidth: 1, borderTopColor: '#f0f1f5', paddingTop: 11 },
	mkLabel: { fontFamily: font.regular, fontSize: 13, color: colors.textSub },
	mkValue: { fontFamily: font.semibold, fontSize: 12.5 },
});

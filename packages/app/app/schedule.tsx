import type { JobStatus } from '@rivus/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
	ActivityIndicator,
	Alert,
	Platform,
	Pressable,
	ScrollView,
	StyleSheet,
	useWindowDimensions,
	View,
} from 'react-native';
import { ApiError, type Customer, type Job, type Member } from '@/src/api/client';
import { getGoogleMapsApiKey } from '@/src/api/config';
import { useAuth } from '@/src/auth/AuthContext';
import { AddressAutocomplete } from '@/src/components/AddressAutocomplete';
import {
	Card,
	GradientButton,
	GradientMark,
	Icon,
	OutlineButton,
	Pill,
	RivusStatusChip,
	Select,
	TextField,
	Txt,
} from '@/src/components/ui';
import {
	addDays,
	type DayCell,
	DURATION_OPTIONS,
	dateFromKeyAndMinutes,
	dayRange,
	formatClock,
	formatDayLabel,
	formatHourLabel,
	formatRangeLabel,
	gridHours,
	HOUR_HEIGHT,
	isoFromKeyAndMinutes,
	isValidDateKey,
	type LanePlacement,
	localDateKey,
	minutesSinceMidnight,
	packLanes,
	placeEvent,
	startOfDay,
	startOfWeek,
	timeOptions,
	weekDays,
	weekRange,
} from '@/src/schedule/datetime';
import { colors, font, radii, SIDEBAR_BREAKPOINT, SIDEBAR_WIDTH } from '@/src/theme/tokens';

const GUTTER = 58;
const MIN_DAY_WIDTH = 132;
// Expand the touch target of small icon buttons to the ~44dp mobile minimum
// without changing their visual size.
const NAV_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };
const CLOSE_HIT_SLOP = { top: 13, bottom: 13, left: 13, right: 13 };

type ScheduleView = 'week' | 'day' | 'list';

/** Categorical colors for assignee lanes (not status — these just tell techs apart). */
const ASSIGNEE_TONES = [
	{ dot: '#1ebefa', bg: 'rgba(30,190,250,0.14)', ink: '#13658a' },
	{ dot: '#6e1ec8', bg: 'rgba(110,30,200,0.12)', ink: '#6e1ec8' },
	{ dot: '#1fb573', bg: 'rgba(31,181,115,0.14)', ink: '#157a4e' },
	{ dot: '#f0a020', bg: 'rgba(240,160,32,0.16)', ink: '#a4720f' },
	{ dot: '#f0584b', bg: 'rgba(240,88,75,0.13)', ink: '#c1483b' },
	{ dot: '#3b6ef0', bg: 'rgba(59,110,240,0.13)', ink: '#274bb0' },
] as const;
const UNASSIGNED_TONE = { dot: '#9a9bb0', bg: '#f1f2f6', ink: '#8a8b99' } as const;
const CANCELED_TONE = { dot: '#c4c5d0', bg: '#f4f5f8', ink: '#a6a8b4' } as const;

const STATUS_META: Record<JobStatus, { label: string; color: string; bg: string }> = {
	scheduled: { label: 'Scheduled', color: colors.textSub, bg: colors.chipBg },
	confirmed: { label: 'Confirmed', color: colors.green, bg: 'rgba(31,181,115,0.12)' },
	in_progress: { label: 'In progress', color: colors.brandPurple, bg: colors.purpleTint },
	completed: { label: 'Completed', color: '#157a4e', bg: 'rgba(31,181,115,0.16)' },
	canceled: { label: 'Canceled', color: colors.redInk, bg: 'rgba(240,88,75,0.12)' },
};
const STATUS_OPTIONS = (Object.keys(STATUS_META) as JobStatus[]).map((value) => ({
	label: STATUS_META[value].label,
	value,
}));

/** Format integer cents as a grouped dollar string (54000 → "$540.00"). */
function formatMoney(cents: number): string {
	const sign = cents < 0 ? '-' : '';
	const abs = Math.abs(cents);
	const dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	return `${sign}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

/** Parse a dollar text input into integer cents; returns null when invalid. */
function dollarsToCents(text: string): number | null {
	const trimmed = text.trim();
	if (trimmed === '') {
		return 0;
	}
	const cleaned = trimmed.replace(/[$,]/g, '');
	if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
		return null;
	}
	return Math.round(Number(cleaned) * 100);
}

/** Pre-fill the dollar input when editing (0 shows blank so the placeholder shows). */
function centsToInput(cents: number): string {
	if (cents === 0) {
		return '';
	}
	return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

export default function ScheduleScreen() {
	const { session, client } = useAuth();
	const { width } = useWindowDimensions();
	const sidebar = width >= SIDEBAR_BREAKPOINT ? SIDEBAR_WIDTH : 0;

	const [view, setView] = useState<ScheduleView>('week');
	const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));
	const [jobs, setJobs] = useState<Job[]>([]);
	const [customers, setCustomers] = useState<Customer[]>([]);
	const [members, setMembers] = useState<Member[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// Form state (create + edit), kept on the screen like the customers screen.
	const [formOpen, setFormOpen] = useState(false);
	const [editing, setEditing] = useState<Job | null>(null);
	const [title, setTitle] = useState('');
	const [customerId, setCustomerId] = useState('');
	const [assignedUserId, setAssignedUserId] = useState('');
	const [dateKey, setDateKey] = useState('');
	const [startMinutes, setStartMinutes] = useState('540'); // 9:00 AM
	const [durationMinutes, setDurationMinutes] = useState('60');
	const [status, setStatus] = useState<JobStatus>('scheduled');
	const [valueInput, setValueInput] = useState('');
	const [address, setAddress] = useState('');
	const [notes, setNotes] = useState('');
	const [formError, setFormError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [conflicts, setConflicts] = useState<Job[]>([]);

	const today = useMemo(() => startOfDay(new Date()), []);
	const mapsApiKey = useMemo(() => (Platform.OS === 'web' ? getGoogleMapsApiKey() : null), []);

	// Stable assignee → tone mapping based on member order, so a tech keeps a color.
	const toneByUser = useMemo(() => {
		const map = new Map<string, (typeof ASSIGNEE_TONES)[number]>();
		members.forEach((member, index) => {
			map.set(member.userId, ASSIGNEE_TONES[index % ASSIGNEE_TONES.length]);
		});
		return map;
	}, [members]);

	const customerName = useCallback(
		(id: string) => customers.find((customer) => customer.id === id)?.name ?? '',
		[customers],
	);
	const memberName = useCallback(
		(id: string) => members.find((member) => member.userId === id)?.name ?? '',
		[members],
	);
	const toneForJob = useCallback(
		(job: Job) => {
			if (job.status === 'canceled') {
				return CANCELED_TONE;
			}
			return job.assignedUserId
				? (toneByUser.get(job.assignedUserId) ?? UNASSIGNED_TONE)
				: UNASSIGNED_TONE;
		},
		[toneByUser],
	);

	// The visible window: a week, a single day, or (list) the next 30 days.
	const range = useMemo(() => {
		if (view === 'day') {
			return dayRange(anchor);
		}
		if (view === 'list') {
			const start = startOfDay(today);
			return { from: start.toISOString(), to: addDays(start, 30).toISOString() };
		}
		return weekRange(anchor);
	}, [view, anchor, today]);

	const load = useCallback(
		async (isActive: () => boolean = () => true) => {
			if (!session) {
				return;
			}
			setLoading(true);
			setError(null);
			try {
				// Page through everything in the window so a busy day past pageSize 100 is
				// never silently truncated, then load the lookups the calendar joins on.
				const collected: Job[] = [];
				const MAX_PAGES = 50;
				let page = 1;
				let hasNext = true;
				while (hasNext && page <= MAX_PAGES) {
					const { data, meta } = await client.listJobs(session.token, {
						from: range.from,
						to: range.to,
						page,
						pageSize: 100,
					});
					collected.push(...data);
					hasNext = meta.hasNextPage;
					page += 1;
				}

				const customerPages: Customer[] = [];
				page = 1;
				hasNext = true;
				while (hasNext && page <= MAX_PAGES) {
					const { data, meta } = await client.listCustomers(session.token, { page, pageSize: 100 });
					customerPages.push(...data);
					hasNext = meta.hasNextPage;
					page += 1;
				}

				const roster = await client.listMembers(session.token);

				if (isActive()) {
					setJobs(collected);
					setCustomers(customerPages);
					setMembers(roster.members);
				}
			} catch (caught) {
				if (isActive()) {
					setError(caught instanceof ApiError ? caught.message : 'Could not load your schedule.');
				}
			} finally {
				if (isActive()) {
					setLoading(false);
				}
			}
		},
		[client, session, range.from, range.to],
	);

	useEffect(() => {
		let active = true;
		load(() => active);
		return () => {
			active = false;
		};
	}, [load]);

	// Live double-booking check while the form is open: re-run whenever the assignee
	// or proposed slot changes, ignoring stale responses if they change again mid-flight.
	useEffect(() => {
		if (!session || !formOpen || !assignedUserId || !isValidDateKey(dateKey)) {
			setConflicts([]);
			return;
		}
		let active = true;
		const startAt = isoFromKeyAndMinutes(dateKey, Number(startMinutes));
		client
			.getJobConflicts(session.token, {
				assignedUserId,
				startAt,
				durationMinutes: Number(durationMinutes),
				excludeJobId: editing?.id,
			})
			.then((result) => {
				if (active) {
					setConflicts(result.conflicts);
				}
			})
			.catch(() => {
				// A failed pre-check shouldn't block scheduling; just drop the warning.
				if (active) {
					setConflicts([]);
				}
			});
		return () => {
			active = false;
		};
	}, [session, client, formOpen, assignedUserId, dateKey, startMinutes, durationMinutes, editing]);

	function resetForm() {
		setTitle('');
		setCustomerId('');
		setAssignedUserId('');
		setStartMinutes('540');
		setDurationMinutes('60');
		setStatus('scheduled');
		setValueInput('');
		setAddress('');
		setNotes('');
		setFormError(null);
		setConflicts([]);
	}

	function openCreate(key: string = localDateKey(anchor), minutes = 540) {
		setEditing(null);
		resetForm();
		setDateKey(key);
		setStartMinutes(String(minutes));
		setFormOpen(true);
	}

	function openEdit(job: Job) {
		const start = new Date(job.startAt);
		setEditing(job);
		setTitle(job.title);
		setCustomerId(job.customerId);
		setAssignedUserId(job.assignedUserId);
		setDateKey(localDateKey(start));
		setStartMinutes(String(minutesSinceMidnight(start)));
		setDurationMinutes(String(job.durationMinutes));
		setStatus(job.status);
		setValueInput(centsToInput(job.estimatedValue));
		setAddress(job.address);
		setNotes(job.notes);
		setFormError(null);
		setConflicts([]);
		setFormOpen(true);
	}

	function closeForm() {
		setFormOpen(false);
		setFormError(null);
	}

	async function onSave() {
		if (!session || saving) {
			return;
		}
		if (title.trim() === '') {
			setFormError('Give the job a service title.');
			return;
		}
		if (!isValidDateKey(dateKey)) {
			setFormError('Enter a valid date as YYYY-MM-DD.');
			return;
		}
		const estimatedValue = dollarsToCents(valueInput);
		if (estimatedValue === null) {
			setFormError('Enter a valid, non-negative estimated value.');
			return;
		}
		setFormError(null);
		setSaving(true);
		try {
			const input = {
				title: title.trim(),
				customerId,
				assignedUserId,
				startAt: isoFromKeyAndMinutes(dateKey, Number(startMinutes)),
				durationMinutes: Number(durationMinutes),
				status,
				address: address.trim(),
				notes: notes.trim(),
				estimatedValue,
			};
			if (editing) {
				await client.updateJob(session.token, editing.id, input);
			} else {
				await client.createJob(session.token, input);
			}
			closeForm();
			await load();
		} catch (caught) {
			setFormError(caught instanceof Error ? caught.message : 'Could not save the job.');
		} finally {
			setSaving(false);
		}
	}

	async function performDelete(job: Job) {
		if (!session) {
			return;
		}
		setFormError(null);
		setDeleting(true);
		try {
			await client.deleteJob(session.token, job.id);
			closeForm();
			await load();
		} catch (caught) {
			setFormError(caught instanceof ApiError ? caught.message : 'Could not delete the job.');
		} finally {
			setDeleting(false);
		}
	}

	// Deleting a job is irreversible, so confirm first — a native alert on device,
	// the browser's confirm on web (RN's Alert is a no-op under react-native-web).
	function onDelete() {
		if (!editing || deleting) {
			return;
		}
		const job = editing;
		const message = `Delete "${job.title}"? This can't be undone.`;
		if (Platform.OS === 'web') {
			if (typeof window !== 'undefined' && window.confirm(message)) {
				performDelete(job);
			}
			return;
		}
		Alert.alert('Delete job', message, [
			{ text: 'Cancel', style: 'cancel' },
			{ text: 'Delete', style: 'destructive', onPress: () => performDelete(job) },
		]);
	}

	if (!session) {
		return null;
	}

	const days = view === 'day' ? [singleDay(anchor, today)] : weekDays(anchor, today);
	const rangeStart = view === 'day' ? startOfDay(anchor) : startOfWeek(anchor);
	const rangeEnd = view === 'day' ? rangeStart : addDays(rangeStart, 6);
	const rangeLabel =
		view === 'day' ? formatDayLabel(anchor) : formatRangeLabel(rangeStart, rangeEnd);
	const navStep = view === 'day' ? 1 : 7;

	const jobsByDay = groupByDay(jobs);
	const customerOptions = [
		{ label: '— No customer —', value: '' },
		...customers.map((customer) => ({ label: customer.name, value: customer.id })),
	];
	const assigneeOptions = [
		{ label: '— Unassigned —', value: '' },
		...members.map((member) => ({ label: member.name, value: member.userId })),
	];

	const bookedCount = jobs.filter((job) => job.status !== 'canceled').length;

	return (
		<View style={styles.screen}>
			<View style={styles.header}>
				<View style={styles.headerLeft}>
					<Txt style={styles.title}>Schedule</Txt>
					{view !== 'list' ? (
						<View style={styles.dateNav}>
							<Pressable
								style={styles.navBtn}
								onPress={() => setAnchor((current) => addDays(current, -navStep))}
								accessibilityRole="button"
								accessibilityLabel="Previous"
								hitSlop={NAV_HIT_SLOP}
							>
								<Icon name="chevron-left" size={16} color={colors.textSub} />
							</Pressable>
							<Pressable style={styles.todayBtn} onPress={() => setAnchor(today)}>
								<Txt style={styles.todayBtnTxt}>Today</Txt>
							</Pressable>
							<Pressable
								style={styles.navBtn}
								onPress={() => setAnchor((current) => addDays(current, navStep))}
								accessibilityRole="button"
								accessibilityLabel="Next"
								hitSlop={NAV_HIT_SLOP}
							>
								<Icon name="chevron-right" size={16} color={colors.textSub} />
							</Pressable>
						</View>
					) : null}
					<Txt style={styles.rangeLabel}>{view === 'list' ? 'Next 30 days' : rangeLabel}</Txt>
				</View>
				<View style={styles.headerRight}>
					<RivusStatusChip label={`${bookedCount} ${bookedCount === 1 ? 'job' : 'jobs'} booked`} />
					<View style={styles.toggle}>
						{(['day', 'week', 'list'] as ScheduleView[]).map((option) => {
							const active = view === option;
							return (
								<Pressable
									key={option}
									onPress={() => setView(option)}
									style={[styles.toggleItem, active && styles.toggleItemActive]}
								>
									<Txt style={[styles.toggleTxt, active && styles.toggleTxtActive]}>
										{option === 'day' ? 'Day' : option === 'week' ? 'Week' : 'List'}
									</Txt>
								</Pressable>
							);
						})}
					</View>
					<GradientButton
						label="New job"
						icon="plus"
						onPress={() => openCreate(localDateKey(view === 'list' ? today : anchor), 540)}
					/>
				</View>
			</View>

			{members.length > 0 ? (
				<View style={styles.legend}>
					{members.map((member) => {
						const tone = toneByUser.get(member.userId) ?? UNASSIGNED_TONE;
						return (
							<View key={member.userId} style={styles.legendItem}>
								<View style={[styles.legendSwatch, { backgroundColor: tone.dot }]} />
								<Txt style={styles.legendTxt}>{member.name}</Txt>
							</View>
						);
					})}
				</View>
			) : null}

			{formOpen ? (
				<View style={styles.formWrap}>
					<Card style={styles.form}>
						<View style={styles.formHead}>
							<Txt style={styles.formTitle}>{editing ? 'Edit job' : 'New job'}</Txt>
							<Pressable
								onPress={closeForm}
								accessibilityRole="button"
								accessibilityLabel="Close"
								hitSlop={CLOSE_HIT_SLOP}
							>
								<Icon name="x" size={18} color={colors.textMuted} />
							</Pressable>
						</View>

						<TextField
							label="Service"
							value={title}
							onChangeText={setTitle}
							placeholder="Water heater install"
							autoCapitalize="sentences"
						/>

						<View style={styles.formRow}>
							<View style={styles.formCol}>
								<Select
									label="Customer"
									value={customerId}
									options={customerOptions}
									onSelect={setCustomerId}
									placeholder="— No customer —"
									searchable
								/>
							</View>
							<View style={styles.formCol}>
								<Select
									label="Assigned to"
									value={assignedUserId}
									options={assigneeOptions}
									onSelect={setAssignedUserId}
									placeholder="— Unassigned —"
								/>
							</View>
						</View>

						<View style={styles.formRow}>
							<View style={styles.formCol}>
								<TextField
									label="Date"
									value={dateKey}
									onChangeText={setDateKey}
									placeholder="2026-06-24"
									autoCapitalize="none"
								/>
							</View>
							<View style={styles.formCol}>
								<Select
									label="Start"
									value={startMinutes}
									options={timeOptions()}
									onSelect={setStartMinutes}
								/>
							</View>
							<View style={styles.formCol}>
								<Select
									label="Duration"
									value={durationMinutes}
									options={DURATION_OPTIONS}
									onSelect={setDurationMinutes}
								/>
							</View>
						</View>

						<View style={styles.formRow}>
							<View style={styles.formCol}>
								<Select
									label="Status"
									value={status}
									options={STATUS_OPTIONS}
									onSelect={(value) => setStatus(value as JobStatus)}
								/>
							</View>
							<View style={styles.formCol}>
								<TextField
									label="Estimated value ($)"
									value={valueInput}
									onChangeText={setValueInput}
									placeholder="0.00"
									keyboardType="decimal-pad"
								/>
							</View>
						</View>

						<AddressAutocomplete
							label="Service address"
							value={address}
							onChangeText={setAddress}
							placeholder="Defaults to the customer's address"
							apiKey={mapsApiKey}
						/>

						<TextField
							label="Notes"
							value={notes}
							onChangeText={setNotes}
							placeholder="Gate code 1234 · bring the auger"
							multiline
							style={styles.notesInput}
						/>

						{conflicts.length > 0 ? (
							<View style={styles.conflict}>
								<Icon name="alert-triangle" size={15} color={colors.amberInk} />
								<Txt style={styles.conflictTxt}>
									Heads up — {memberName(assignedUserId) || 'this tech'} already has{' '}
									{conflicts.length === 1
										? `"${conflicts[0].title}" at ${formatClock(conflicts[0].startAt)}`
										: `${conflicts.length} overlapping jobs`}
									. You can still book it.
								</Txt>
							</View>
						) : null}

						{formError ? <Txt style={styles.errorTxt}>{formError}</Txt> : null}

						<View style={styles.btnRow}>
							<GradientButton
								label={saving ? 'Saving…' : editing ? 'Save changes' : 'Schedule job'}
								icon="check"
								onPress={onSave}
								style={styles.btnGrow}
							/>
							<OutlineButton label="Cancel" onPress={closeForm} style={styles.btnGrow} />
						</View>
						{editing ? (
							<OutlineButton
								label={deleting ? 'Deleting…' : 'Delete job'}
								onPress={onDelete}
								style={styles.deleteBtn}
							/>
						) : null}
					</Card>
				</View>
			) : null}

			{loading ? (
				<ActivityIndicator color={colors.brandPurple} style={styles.loading} />
			) : error ? (
				<Txt style={styles.errorTxt}>{error}</Txt>
			) : view === 'list' ? (
				<AgendaList
					days={listDays(today, jobsByDay)}
					jobsByDay={jobsByDay}
					customerName={customerName}
					memberName={memberName}
					toneForJob={toneForJob}
					onSelect={openEdit}
				/>
			) : (
				<CalendarGrid
					days={days}
					sidebar={sidebar}
					containerWidth={width}
					jobsByDay={jobsByDay}
					customerName={customerName}
					memberName={memberName}
					toneForJob={toneForJob}
					onCreate={(key, minutes) => openCreate(key, minutes)}
					onSelect={openEdit}
				/>
			)}
		</View>
	);
}

/** A single-day "week" of one cell, reusing the grid for the day view. */
function singleDay(date: Date, today: Date): DayCell {
	const key = localDateKey(date);
	const dow = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][date.getDay()];
	return { date, key, dow, dayNum: date.getDate(), isToday: key === localDateKey(today) };
}

/** Group jobs into local-day buckets, each sorted by start time. */
function groupByDay(jobs: Job[]): Map<string, Job[]> {
	const map = new Map<string, Job[]>();
	for (const job of jobs) {
		const key = localDateKey(new Date(job.startAt));
		const bucket = map.get(key);
		if (bucket) {
			bucket.push(job);
		} else {
			map.set(key, [job]);
		}
	}
	for (const bucket of map.values()) {
		bucket.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
	}
	return map;
}

/** Day cells that actually have jobs, soonest first, for the agenda list. */
function listDays(today: Date, jobsByDay: Map<string, Job[]>): DayCell[] {
	const todayKey = localDateKey(today);
	return [...jobsByDay.keys()]
		.filter((key) => jobsByDay.get(key)?.length)
		.sort()
		.map((key) => {
			// Build the local date numerically — `new Date("YYYY-MM-DDT00:00:00")` is
			// parsed inconsistently across JS engines (some as UTC), which would shift
			// the weekday/day label by the local offset.
			const date = dateFromKeyAndMinutes(key, 0);
			const dow = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][date.getDay()];
			return { date, key, dow, dayNum: date.getDate(), isToday: key === todayKey };
		});
}

type Tone = { dot: string; bg: string; ink: string };

interface GridProps {
	days: DayCell[];
	sidebar: number;
	containerWidth: number;
	jobsByDay: Map<string, Job[]>;
	customerName: (id: string) => string;
	memberName: (id: string) => string;
	toneForJob: (job: Job) => Tone;
	onCreate: (key: string, minutes: number) => void;
	onSelect: (job: Job) => void;
}

function CalendarGrid({
	days,
	sidebar,
	containerWidth,
	jobsByDay,
	customerName,
	memberName,
	toneForJob,
	onCreate,
	onSelect,
}: GridProps) {
	const hours = gridHours();
	const gridHeight = hours.length * HOUR_HEIGHT;
	const avail = containerWidth - sidebar - 48;
	const dayWidth =
		days.length === 1
			? Math.max(260, avail - GUTTER)
			: Math.max(MIN_DAY_WIDTH, (avail - GUTTER) / days.length);
	// Pre-compute side-by-side lanes per day so overlapping jobs don't stack.
	const lanesByDay = new Map(
		days.map((day) => [day.key, packLanes(jobsByDay.get(day.key) ?? [])] as const),
	);

	return (
		<ScrollView style={styles.gridScroll}>
			<ScrollView horizontal showsHorizontalScrollIndicator={false}>
				<View>
					<View style={styles.dayHeaderRow}>
						<View style={{ width: GUTTER }} />
						{days.map((day) => (
							<View key={day.key} style={[styles.dayHeader, { width: dayWidth }]}>
								<Txt style={styles.dayDow}>{day.dow}</Txt>
								<Txt style={[styles.dayDate, day.isToday && styles.dayDateToday]}>{day.dayNum}</Txt>
							</View>
						))}
					</View>

					<View style={styles.gridBody}>
						<View style={{ width: GUTTER }}>
							{hours.map((hour) => (
								<View key={hour} style={styles.hourCell}>
									<Txt style={styles.hourLabel}>{formatHourLabel(hour)}</Txt>
								</View>
							))}
						</View>

						{days.map((day) => (
							<View
								key={day.key}
								style={[
									styles.dayCol,
									{ width: dayWidth, height: gridHeight },
									day.isToday && styles.dayColToday,
								]}
							>
								{hours.map((hour) => (
									<Pressable
										key={hour}
										style={styles.gridLine}
										onPress={() => onCreate(day.key, hour * 60)}
									/>
								))}
								{(jobsByDay.get(day.key) ?? []).map((job, index) => (
									<EventBlock
										key={job.id}
										job={job}
										tone={toneForJob(job)}
										placement={lanesByDay.get(day.key)?.[index] ?? { lane: 0, columns: 1 }}
										dayWidth={dayWidth}
										customerName={customerName}
										memberName={memberName}
										onSelect={onSelect}
									/>
								))}
							</View>
						))}
					</View>
				</View>
			</ScrollView>
		</ScrollView>
	);
}

const EVENT_INSET = 4;
const LANE_GAP = 3;

function EventBlock({
	job,
	tone,
	placement,
	dayWidth,
	customerName,
	memberName,
	onSelect,
}: {
	job: Job;
	tone: Tone;
	placement: LanePlacement;
	dayWidth: number;
	customerName: (id: string) => string;
	memberName: (id: string) => string;
	onSelect: (job: Job) => void;
}) {
	const { top, height } = placeEvent(job.startAt, job.durationMinutes);
	// Split the column into the cluster's lanes so overlapping jobs sit side by side.
	const laneWidth = (dayWidth - EVENT_INSET * 2) / placement.columns;
	const left = EVENT_INSET + placement.lane * laneWidth;
	const width = laneWidth - (placement.columns > 1 ? LANE_GAP : 0);
	const who = [customerName(job.customerId), memberName(job.assignedUserId)]
		.filter(Boolean)
		.join(' · ');
	return (
		<Pressable
			onPress={() => onSelect(job)}
			style={[
				styles.event,
				{ top, height, left, width, backgroundColor: tone.bg },
				job.status === 'canceled' && styles.eventCanceled,
			]}
		>
			<View style={styles.eventTitleRow}>
				<Txt style={[styles.eventTitle, { color: tone.ink }]} numberOfLines={1}>
					{formatClock(job.startAt)} · {job.title}
				</Txt>
				{job.assignedUserId ? null : <GradientMark size={12} radius={4} iconSize={7} icon="user" />}
			</View>
			{who ? (
				<Txt style={[styles.eventSub, { color: tone.ink }]} numberOfLines={1}>
					{who}
				</Txt>
			) : null}
		</Pressable>
	);
}

function AgendaList({
	days,
	jobsByDay,
	customerName,
	memberName,
	toneForJob,
	onSelect,
}: {
	days: DayCell[];
	jobsByDay: Map<string, Job[]>;
	customerName: (id: string) => string;
	memberName: (id: string) => string;
	toneForJob: (job: Job) => Tone;
	onSelect: (job: Job) => void;
}) {
	if (days.length === 0) {
		return (
			<Txt style={styles.empty}>
				No jobs scheduled in the next 30 days. Tap “New job” to book one.
			</Txt>
		);
	}
	return (
		<ScrollView style={{ flex: 1 }} contentContainerStyle={styles.agendaPad}>
			{days.map((day) => (
				<View key={day.key} style={styles.agendaDay}>
					<View style={styles.agendaHead}>
						<Txt style={styles.agendaDow}>{day.dow}</Txt>
						<Txt style={[styles.agendaDate, day.isToday && styles.dayDateToday]}>
							{formatDayLabel(day.date)}
						</Txt>
					</View>
					<Card padded={false} style={styles.agendaCard}>
						{(jobsByDay.get(day.key) ?? []).map((job, index, all) => {
							const tone = toneForJob(job);
							const meta = STATUS_META[job.status];
							const who = [customerName(job.customerId), memberName(job.assignedUserId)]
								.filter(Boolean)
								.join(' · ');
							return (
								<Pressable
									key={job.id}
									onPress={() => onSelect(job)}
									style={[styles.agendaRow, index === all.length - 1 && styles.agendaRowLast]}
								>
									<Txt style={styles.agendaTime}>{formatClock(job.startAt)}</Txt>
									<View style={[styles.agendaDot, { backgroundColor: tone.dot }]} />
									<View style={styles.agendaMain}>
										<Txt style={styles.agendaTitle} numberOfLines={1}>
											{job.title}
										</Txt>
										{who ? (
											<Txt style={styles.agendaSub} numberOfLines={1}>
												{who}
											</Txt>
										) : null}
									</View>
									{job.estimatedValue > 0 ? (
										<Txt style={styles.agendaValue}>{formatMoney(job.estimatedValue)}</Txt>
									) : null}
									<Pill label={meta.label} color={meta.color} background={meta.bg} />
								</Pressable>
							);
						})}
					</Card>
				</View>
			))}
		</ScrollView>
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
		paddingBottom: 14,
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
	todayBtn: {
		height: 32,
		paddingHorizontal: 12,
		borderRadius: radii.sm,
		borderWidth: 1,
		borderColor: colors.borderField,
		alignItems: 'center',
		justifyContent: 'center',
	},
	todayBtnTxt: { fontFamily: font.semibold, fontSize: 12.5, color: colors.textSub },
	rangeLabel: { fontFamily: font.semibold, fontSize: 14, color: colors.text },
	headerRight: { flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
	toggle: { flexDirection: 'row', backgroundColor: '#f1f2f6', borderRadius: 9, padding: 3 },
	toggleItem: { paddingVertical: 6, paddingHorizontal: 13, borderRadius: 7 },
	toggleItemActive: { backgroundColor: colors.surface },
	toggleTxt: { fontFamily: font.medium, fontSize: 12.5, color: colors.textMuted },
	toggleTxtActive: { fontFamily: font.semibold, color: colors.text },

	legend: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 16,
		flexWrap: 'wrap',
		paddingHorizontal: 28,
		paddingVertical: 12,
		borderBottomWidth: 1,
		borderBottomColor: colors.border,
		backgroundColor: colors.surface,
	},
	legendItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
	legendSwatch: { width: 10, height: 10, borderRadius: 3 },
	legendTxt: { fontFamily: font.regular, fontSize: 12, color: colors.textSub },

	formWrap: { paddingHorizontal: 24, paddingTop: 18 },
	form: { gap: 14 },
	formHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
	formTitle: { fontFamily: font.semibold, fontSize: 15, color: colors.text },
	formRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
	formCol: { flexGrow: 1, flexBasis: 160 },
	notesInput: { minHeight: 70, textAlignVertical: 'top' },
	conflict: {
		flexDirection: 'row',
		alignItems: 'flex-start',
		gap: 9,
		backgroundColor: 'rgba(240,160,32,0.1)',
		borderRadius: radii.md,
		padding: 11,
	},
	conflictTxt: {
		flex: 1,
		fontFamily: font.medium,
		fontSize: 12.5,
		color: colors.amberInk,
		lineHeight: 18,
	},
	btnRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
	btnGrow: { flexGrow: 1, flexBasis: 140 },
	deleteBtn: { borderColor: 'rgba(240,88,75,0.4)' },
	errorTxt: {
		fontFamily: font.medium,
		fontSize: 12.5,
		color: colors.redInk,
		paddingHorizontal: 24,
	},
	loading: { paddingVertical: 40 },
	empty: {
		fontFamily: font.regular,
		fontSize: 13,
		color: colors.textMuted,
		padding: 28,
	},

	gridScroll: { flex: 1, backgroundColor: colors.surface },
	dayHeaderRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
	dayHeader: {
		alignItems: 'center',
		paddingVertical: 11,
		borderLeftWidth: 1,
		borderLeftColor: '#f0f1f5',
	},
	dayDow: { fontFamily: font.semibold, fontSize: 11, color: colors.textFaint, letterSpacing: 0.5 },
	dayDate: { fontFamily: font.semibold, fontSize: 18, marginTop: 2 },
	dayDateToday: { color: colors.brandPurple },
	gridBody: { flexDirection: 'row' },
	hourCell: { height: HOUR_HEIGHT },
	hourLabel: {
		position: 'absolute',
		top: -7,
		right: 10,
		fontFamily: font.regular,
		fontSize: 11,
		color: colors.textGhost,
	},
	dayCol: { borderLeftWidth: 1, borderLeftColor: '#f0f1f5', overflow: 'hidden' },
	dayColToday: { backgroundColor: 'rgba(110,30,200,0.018)' },
	gridLine: { height: HOUR_HEIGHT, borderBottomWidth: 1, borderBottomColor: '#f0f1f5' },
	// `left` and `width` are set inline per lane (see EventBlock).
	event: {
		position: 'absolute',
		borderRadius: radii.sm,
		paddingVertical: 5,
		paddingHorizontal: 8,
		overflow: 'hidden',
	},
	eventCanceled: { borderWidth: 1, borderStyle: 'dashed', borderColor: '#d3d6e0', opacity: 0.7 },
	eventTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
	eventTitle: { fontFamily: font.semibold, fontSize: 11.5, flexShrink: 1 },
	eventSub: { fontFamily: font.regular, fontSize: 10.5, marginTop: 1, opacity: 0.85 },

	agendaPad: { padding: 24, paddingBottom: 40, gap: 20 },
	agendaDay: { gap: 10 },
	agendaHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
	agendaDow: {
		fontFamily: font.semibold,
		fontSize: 11,
		color: colors.textFaint,
		letterSpacing: 0.6,
	},
	agendaDate: { fontFamily: font.semibold, fontSize: 14, color: colors.text },
	agendaCard: { overflow: 'hidden' },
	agendaRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		paddingVertical: 13,
		paddingHorizontal: 16,
		borderBottomWidth: 1,
		borderBottomColor: colors.borderRow,
	},
	agendaRowLast: { borderBottomWidth: 0 },
	agendaTime: { width: 64, fontFamily: font.semibold, fontSize: 12.5, color: colors.textSub },
	agendaDot: { width: 9, height: 9, borderRadius: 5 },
	agendaMain: { flex: 1, minWidth: 0 },
	agendaTitle: { fontFamily: font.medium, fontSize: 13.5, color: colors.text },
	agendaSub: { fontFamily: font.regular, fontSize: 12, color: colors.textMuted, marginTop: 1 },
	agendaValue: { fontFamily: font.semibold, fontSize: 12.5, color: colors.text },
});

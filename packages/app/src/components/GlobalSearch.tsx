import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
	ActivityIndicator,
	KeyboardAvoidingView,
	Modal,
	Platform,
	Pressable,
	ScrollView,
	StyleSheet,
	TextInput,
	View,
} from 'react-native';
import type { SearchResults } from '@/src/api/client';
import { initialsOf, useAuth } from '@/src/auth/AuthContext';
import { formatClock, formatDayLabel, localDateKey } from '@/src/schedule/datetime';
import { colors, font, radii, shadowSoft } from '@/src/theme/tokens';
import { Avatar, Icon, Txt } from './ui';

/** Debounce window for the search, matching the company switcher / address fields. */
const SEARCH_DEBOUNCE_MS = 250;
/** How many matches of each type the dropdown asks for (the API caps this at 20). */
const RESULT_LIMIT = 8;

const EMPTY_RESULTS: SearchResults = { customers: [], jobs: [] };

const IS_WEB = Platform.OS === 'web';

// react-native-web maps `dataSet` to data-* attributes (here `data-no-focus-ring`).
// It opts the search field out of the global brand focus ring (see focusRing.ts):
// the search row's own border already frames the focused input, so without this the
// web build draws a second purple box around the box. The prop isn't in RN's
// TextInput types, so this is cast; it's a no-op off the web.
const WEB_NO_FOCUS_RING = (IS_WEB ? { dataSet: { noFocusRing: 'true' } } : null) as object | null;

/**
 * The dashboard's global search box. A trigger opens a dropdown that searches the
 * account's customers and jobs (via `GET /v1/search`, backed by MongoDB) as you
 * type, debounced. Selecting a result deep-links to the relevant screen — a
 * customer focuses their CRM record, a job opens the schedule on its day.
 *
 * The trigger adapts to the layout: `topbar` (the default) is the wide layout's
 * field-styled search bar, while `compact` is a bare icon button that sits beside
 * the chat and bell icons in the narrow top bar. Both open the same dropdown.
 */
export function GlobalSearch({ variant = 'topbar' }: { variant?: 'topbar' | 'compact' }) {
	const { session, client } = useAuth();
	const router = useRouter();

	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Monotonic request id so a slow earlier search can't overwrite a newer one.
	const latestRequest = useRef(0);
	// `autoFocus` on a TextInput inside a Modal can miss on native (focus is
	// attempted mid-transition), so we also focus via this ref in the Modal's
	// `onShow`. Keeping `autoFocus` covers web, where react-native-web honors it.
	const inputRef = useRef<TextInput>(null);

	const runSearch = useCallback(
		async (term: string) => {
			const trimmed = term.trim();
			const requestId = latestRequest.current + 1;
			latestRequest.current = requestId;
			// An empty term has no results — clear and skip the round-trip (the API
			// would reject a blank `q` anyway).
			if (!session || trimmed === '') {
				setResults(EMPTY_RESULTS);
				setLoading(false);
				setError(null);
				return;
			}
			setLoading(true);
			setError(null);
			try {
				const data = await client.search(session.token, { q: trimmed, limit: RESULT_LIMIT });
				if (requestId === latestRequest.current) {
					setResults(data);
				}
			} catch {
				if (requestId === latestRequest.current) {
					setResults(EMPTY_RESULTS);
					setError('Could not run that search. Please try again.');
				}
			} finally {
				if (requestId === latestRequest.current) {
					setLoading(false);
				}
			}
		},
		[client, session],
	);

	// Clear any pending debounce when the dropdown closes so a late keystroke can't
	// fire a search against a closed sheet (the cleanup runs on the open→false
	// transition).
	useEffect(() => {
		if (!open) {
			return;
		}
		return () => {
			if (debounce.current) {
				clearTimeout(debounce.current);
			}
		};
	}, [open]);

	function handleQuery(next: string) {
		setQuery(next);
		if (debounce.current) {
			clearTimeout(debounce.current);
		}
		debounce.current = setTimeout(() => void runSearch(next), SEARCH_DEBOUNCE_MS);
	}

	function close() {
		// Bump the request id so any in-flight response is ignored on the way out.
		latestRequest.current += 1;
		setOpen(false);
		setQuery('');
		setResults(EMPTY_RESULTS);
		setLoading(false);
		setError(null);
	}

	function goTo(pathname: '/customers' | '/schedule', focus: string) {
		close();
		router.push({ pathname, params: { focus } });
	}

	const trimmed = query.trim();
	const hasResults = results.customers.length > 0 || results.jobs.length > 0;
	const isCompact = variant === 'compact';

	return (
		<View style={isCompact ? undefined : styles.wrap}>
			{isCompact ? (
				<Pressable
					style={styles.compactTrigger}
					onPress={() => setOpen(true)}
					accessibilityRole="button"
					accessibilityLabel="Search customers and jobs"
					hitSlop={{ top: 5, bottom: 5, left: 5, right: 5 }}
				>
					<Feather name="search" size={18} color="#cfd0dc" />
				</Pressable>
			) : (
				<Pressable
					style={styles.trigger}
					onPress={() => setOpen(true)}
					accessibilityRole="button"
					accessibilityLabel="Search customers and jobs"
				>
					<Icon name="search" size={16} color={colors.textFaint} />
					<Txt style={styles.triggerTxt} numberOfLines={1}>
						Search customers and jobs…
					</Txt>
				</Pressable>
			)}

			<Modal
				visible={open}
				transparent
				animationType="fade"
				onRequestClose={close}
				onShow={() => inputRef.current?.focus()}
			>
				{/* Lift the panel above the on-screen keyboard so the focused input and
				    results stay visible on a phone (matches RivusChat's composer). */}
				<KeyboardAvoidingView
					style={styles.kav}
					behavior={Platform.OS === 'ios' ? 'padding' : undefined}
				>
					<Pressable style={styles.backdrop} onPress={close}>
						{/* Stop taps inside the panel from dismissing it. */}
						<Pressable style={styles.panel} onPress={() => {}}>
							<View style={styles.searchRow}>
								<Feather name="search" size={15} color={colors.textFaint} />
								<TextInput
									ref={inputRef}
									placeholder="Search customers and jobs…"
									placeholderTextColor={colors.textHint}
									value={query}
									onChangeText={handleQuery}
									autoCorrect={false}
									autoCapitalize="none"
									autoFocus
									// Match the API's `q` cap (searchQuerySchema) so an over-long query is
									// prevented here rather than rejected with a 400.
									maxLength={200}
									style={[styles.searchInput, IS_WEB && styles.searchInputWeb]}
									{...WEB_NO_FOCUS_RING}
								/>
								{loading ? <ActivityIndicator size="small" color={colors.brandPurple} /> : null}
							</View>

							{error ? (
								<View style={styles.state}>
									<Txt style={styles.stateTxt}>{error}</Txt>
								</View>
							) : trimmed === '' ? (
								<View style={styles.state}>
									<Txt style={styles.stateTxt}>
										Search your customers and jobs by name or detail.
									</Txt>
								</View>
							) : !hasResults && !loading ? (
								<View style={styles.state}>
									<Txt style={styles.stateTxt}>No matches for “{trimmed}”.</Txt>
								</View>
							) : (
								<ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
									{results.customers.length > 0 ? (
										<View style={styles.section}>
											<Txt style={styles.sectionLabel}>Customers</Txt>
											{results.customers.map((customer) => {
												const detail = customer.email || customer.phone || customer.address;
												return (
													<Pressable
														key={customer.id}
														style={styles.row}
														onPress={() => goTo('/customers', customer.id)}
														accessibilityRole="button"
													>
														<Avatar initials={initialsOf(customer.name)} size={32} />
														<View style={styles.rowText}>
															<Txt style={styles.rowTitle} numberOfLines={1}>
																{customer.name}
															</Txt>
															{detail ? (
																<Txt style={styles.rowSub} numberOfLines={1}>
																	{detail}
																</Txt>
															) : null}
														</View>
													</Pressable>
												);
											})}
										</View>
									) : null}

									{results.jobs.length > 0 ? (
										<View style={styles.section}>
											<Txt style={styles.sectionLabel}>Jobs</Txt>
											{results.jobs.map((job) => {
												const start = new Date(job.startAt);
												return (
													<Pressable
														key={job.id}
														style={styles.row}
														onPress={() => goTo('/schedule', localDateKey(start))}
														accessibilityRole="button"
													>
														<View style={styles.jobIcon}>
															<Icon name="calendar" size={16} color={colors.brandPurple} />
														</View>
														<View style={styles.rowText}>
															<Txt style={styles.rowTitle} numberOfLines={1}>
																{job.title}
															</Txt>
															<Txt style={styles.rowSub} numberOfLines={1}>
																{formatDayLabel(start)} · {formatClock(job.startAt)}
															</Txt>
														</View>
													</Pressable>
												);
											})}
										</View>
									) : null}
								</ScrollView>
							)}
						</Pressable>
					</Pressable>
				</KeyboardAvoidingView>
			</Modal>
		</View>
	);
}

const styles = StyleSheet.create({
	wrap: {
		flex: 1,
		alignItems: 'center',
	},
	trigger: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 9,
		width: 420,
		maxWidth: '100%',
		backgroundColor: colors.field,
		borderWidth: 1,
		borderColor: colors.borderField,
		borderRadius: radii.md,
		paddingVertical: 8,
		paddingHorizontal: 13,
	},
	triggerTxt: {
		flex: 1,
		fontSize: 13,
		color: colors.textFaint,
	},
	// Bare icon button for the narrow top bar, sized to match the chat icon and
	// notifications bell it sits beside.
	compactTrigger: {
		width: 34,
		height: 34,
		alignItems: 'center',
		justifyContent: 'center',
	},
	// Keyboard-avoiding wrapper that fills the modal; the backdrop centers within it.
	kav: {
		flex: 1,
	},
	// Anchor the dropdown near the top center, approximating the trigger's place.
	backdrop: {
		flex: 1,
		alignItems: 'center',
		paddingTop: 58,
	},
	panel: {
		width: 460,
		maxWidth: '92%',
		maxHeight: 460,
		backgroundColor: colors.surface,
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: radii.lg,
		padding: 10,
		gap: 8,
		...shadowSoft,
	},
	searchRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		backgroundColor: colors.field,
		borderWidth: 1,
		borderColor: colors.borderField,
		borderRadius: radii.md,
		paddingHorizontal: 11,
	},
	searchInput: {
		flex: 1,
		fontFamily: font.regular,
		fontSize: 13.5,
		color: colors.text,
		paddingVertical: 9,
	},
	// 16px is the threshold below which mobile Safari auto-zooms a focused input.
	searchInputWeb: {
		fontSize: 16,
	},
	list: {
		flexGrow: 0,
	},
	section: {
		gap: 2,
		marginBottom: 4,
	},
	sectionLabel: {
		fontFamily: font.semibold,
		fontSize: 11,
		letterSpacing: 0.6,
		textTransform: 'uppercase',
		color: colors.textFaint,
		paddingHorizontal: 8,
		paddingTop: 6,
		paddingBottom: 4,
	},
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 11,
		paddingVertical: 8,
		paddingHorizontal: 8,
		borderRadius: radii.md,
	},
	jobIcon: {
		width: 32,
		height: 32,
		borderRadius: radii.sm,
		backgroundColor: colors.purpleTint,
		alignItems: 'center',
		justifyContent: 'center',
	},
	rowText: {
		flex: 1,
		minWidth: 0,
	},
	rowTitle: {
		fontFamily: font.medium,
		fontSize: 13.5,
		color: colors.text,
	},
	rowSub: {
		fontFamily: font.regular,
		fontSize: 11.5,
		color: colors.textMuted,
		marginTop: 1,
	},
	state: {
		paddingVertical: 22,
		paddingHorizontal: 10,
		alignItems: 'center',
		justifyContent: 'center',
	},
	stateTxt: {
		fontSize: 12.5,
		color: colors.textMuted,
		textAlign: 'center',
	},
});

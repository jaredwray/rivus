import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
	ActivityIndicator,
	FlatList,
	Modal,
	Pressable,
	StyleSheet,
	TextInput,
	View,
} from 'react-native';
import type { Account } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { colors, font, radii, SIDEBAR_WIDTH, shadowSoft } from '@/src/theme/tokens';
import { Txt } from './ui';

/** Debounce window for the company search, matching AddressAutocomplete. */
const SEARCH_DEBOUNCE_MS = 250;
/** Plenty for the switcher; the API caps page size at 100. */
const PAGE_SIZE = 50;

/** The rounded square holding a company's first initial. */
function CompanyMark({ letter, small = false }: { letter: string; small?: boolean }) {
	return (
		<View style={[styles.mark, small && styles.markSmall]}>
			<Txt style={[styles.markTxt, small && styles.markTxtSmall]}>{letter}</Txt>
		</View>
	);
}

/**
 * The company shown in the top bar.
 *
 * A regular customer belongs to a single company, so it renders as a plain,
 * non-interactive label. Rivus staff (`@rivus.ai`) instead get a dropdown with a
 * search filter to jump into any company — selecting one re-issues their session
 * scoped to it via {@link AuthContextValue.switchCompany}.
 */
export function CompanySwitcher() {
	const { session, isStaff, client, switchCompany } = useAuth();
	const account = session?.account;

	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	const [companies, setCompanies] = useState<Account[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [switchingId, setSwitchingId] = useState<string | null>(null);
	const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Monotonic request id so a slow earlier search can't overwrite a newer one.
	const latestRequest = useRef(0);

	const runSearch = useCallback(
		async (term: string) => {
			if (!session) {
				return;
			}
			const requestId = latestRequest.current + 1;
			latestRequest.current = requestId;
			setLoading(true);
			setError(null);
			try {
				const { data } = await client.listCompanies(session.token, {
					search: term,
					pageSize: PAGE_SIZE,
				});
				if (requestId === latestRequest.current) {
					setCompanies(data);
				}
			} catch {
				if (requestId === latestRequest.current) {
					setCompanies([]);
					setError('Could not load companies. Please try again.');
				}
			} finally {
				if (requestId === latestRequest.current) {
					setLoading(false);
				}
			}
		},
		[client, session],
	);

	// Load the full list each time the dropdown opens; clear any pending debounce
	// when it closes so a late keystroke doesn't fire against a closed sheet.
	useEffect(() => {
		if (!open) {
			return;
		}
		void runSearch('');
		return () => {
			if (debounce.current) {
				clearTimeout(debounce.current);
			}
		};
	}, [open, runSearch]);

	function handleQuery(next: string) {
		setQuery(next);
		if (debounce.current) {
			clearTimeout(debounce.current);
		}
		debounce.current = setTimeout(() => void runSearch(next), SEARCH_DEBOUNCE_MS);
	}

	function close() {
		setOpen(false);
		setQuery('');
	}

	async function choose(target: Account) {
		// Picking the current company is a no-op beyond closing the sheet.
		if (target.id === account?.id) {
			close();
			return;
		}
		setSwitchingId(target.id);
		setError(null);
		try {
			await switchCompany(target.id);
			close();
		} catch {
			setError('Could not switch company. Please try again.');
		} finally {
			setSwitchingId(null);
		}
	}

	if (!account) {
		return null;
	}

	const initial = account.name.charAt(0).toUpperCase();
	const subtitle = account.address || account.timezone || '';

	// One company per customer: no switcher, just the company label.
	if (!isStaff) {
		return (
			<View style={styles.trigger}>
				<CompanyMark letter={initial} />
				<View style={styles.labels}>
					<Txt style={styles.name}>{account.name}</Txt>
					{subtitle ? <Txt style={styles.sub}>{subtitle}</Txt> : null}
				</View>
			</View>
		);
	}

	return (
		<>
			<Pressable
				style={styles.trigger}
				onPress={() => setOpen(true)}
				accessibilityRole="button"
				accessibilityLabel="Switch company"
			>
				<CompanyMark letter={initial} />
				<View style={styles.labels}>
					<Txt style={styles.name}>{account.name}</Txt>
					{subtitle ? <Txt style={styles.sub}>{subtitle}</Txt> : null}
				</View>
				<Feather name="chevron-down" size={15} color={colors.textHint} />
			</Pressable>

			<Modal visible={open} transparent animationType="fade" onRequestClose={close}>
				<Pressable style={styles.backdrop} onPress={close}>
					{/* Stop taps inside the panel from dismissing it. */}
					<Pressable style={styles.panel} onPress={() => {}}>
						<View style={styles.searchRow}>
							<Feather name="search" size={15} color={colors.textFaint} />
							<TextInput
								placeholder="Search companies…"
								placeholderTextColor={colors.textHint}
								value={query}
								onChangeText={handleQuery}
								autoCorrect={false}
								autoCapitalize="none"
								autoFocus
								style={styles.searchInput}
							/>
						</View>

						{loading ? (
							<View style={styles.state}>
								<ActivityIndicator color={colors.brandPurple} />
							</View>
						) : error ? (
							<View style={styles.state}>
								<Txt style={styles.stateTxt}>{error}</Txt>
							</View>
						) : companies.length === 0 ? (
							<View style={styles.state}>
								<Txt style={styles.stateTxt}>No companies found.</Txt>
							</View>
						) : (
							<FlatList
								data={companies}
								keyExtractor={(company) => company.id}
								keyboardShouldPersistTaps="handled"
								style={styles.list}
								renderItem={({ item }) => {
									const active = item.id === account.id;
									return (
										<Pressable
											onPress={() => void choose(item)}
											style={[styles.row, active && styles.rowActive]}
										>
											<CompanyMark letter={item.name.charAt(0).toUpperCase()} small />
											<View style={styles.labels}>
												<Txt style={[styles.rowName, active && styles.rowNameActive]}>
													{item.name}
												</Txt>
												{item.address ? (
													<Txt style={styles.sub} numberOfLines={1}>
														{item.address}
													</Txt>
												) : null}
											</View>
											{switchingId === item.id ? (
												<ActivityIndicator size="small" color={colors.brandPurple} />
											) : active ? (
												<Feather name="check" size={16} color={colors.brandPurple} />
											) : null}
										</Pressable>
									);
								}}
							/>
						)}
					</Pressable>
				</Pressable>
			</Modal>
		</>
	);
}

const styles = StyleSheet.create({
	trigger: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 10,
	},
	labels: {
		flex: 1,
		minWidth: 0,
	},
	mark: {
		width: 30,
		height: 30,
		borderRadius: radii.sm,
		backgroundColor: '#0e2a36',
		alignItems: 'center',
		justifyContent: 'center',
	},
	markSmall: {
		width: 26,
		height: 26,
	},
	markTxt: {
		fontFamily: font.bold,
		fontSize: 13,
		color: colors.brandCyan,
	},
	markTxtSmall: {
		fontSize: 12,
	},
	name: {
		fontFamily: font.semibold,
		fontSize: 13.5,
	},
	sub: {
		fontFamily: font.regular,
		fontSize: 11,
		color: colors.textMuted,
	},
	// The dropdown is anchored under the company button (top bar lives only in the
	// wide layout, beside the fixed-width sidebar), approximating a popover.
	backdrop: {
		flex: 1,
		alignItems: 'flex-start',
		justifyContent: 'flex-start',
		paddingTop: 58,
		paddingLeft: SIDEBAR_WIDTH + 18,
	},
	panel: {
		width: 320,
		maxHeight: 440,
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
	list: {
		flexGrow: 0,
	},
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 10,
		paddingVertical: 9,
		paddingHorizontal: 8,
		borderRadius: radii.md,
	},
	rowActive: {
		backgroundColor: colors.field,
	},
	rowName: {
		fontFamily: font.medium,
		fontSize: 13.5,
		color: colors.textSub,
	},
	rowNameActive: {
		fontFamily: font.semibold,
		color: colors.text,
	},
	state: {
		paddingVertical: 24,
		alignItems: 'center',
		justifyContent: 'center',
	},
	stateTxt: {
		fontSize: 12.5,
		color: colors.textMuted,
	},
});

import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ApiError, type Customer, type TesterChannel, type TesterSession } from '@/src/api/client';
import { initialsOf, useAuth } from '@/src/auth/AuthContext';
import { BrandGradient } from '@/src/components/Gradient';
import { Avatar, GradientButton, Segmented, TextField, Txt } from '@/src/components/ui';
import { colors, font, radii, shadowSoft } from '@/src/theme/tokens';
import { addressFor, addressPlaceholder, CHANNEL_META, missingAddressHint } from './meta';

/**
 * The browse list shown before anything is typed: the CRM's first page. Anything
 * typed goes to the server instead (see the search effect) — filtering this page
 * locally would hide every customer past it from the picker.
 */
const CUSTOMER_PAGE_SIZE = 100;

/** Per-type cap `/v1/search` accepts, and what a typed term asks for. */
const SEARCH_LIMIT = 20;

/** How long typing settles before a term goes to the server. */
const SEARCH_DEBOUNCE_MS = 250;

const CHANNEL_OPTIONS: { label: string; value: TesterChannel }[] = [
	{ label: CHANNEL_META.email.label, value: 'email' },
	{ label: CHANNEL_META.sms.label, value: 'sms' },
	{ label: CHANNEL_META.whatsapp.label, value: 'whatsapp' },
	{ label: CHANNEL_META.phone.label, value: 'phone' },
];

type Mode = 'customer' | 'custom';

const MODE_OPTIONS: { label: string; value: Mode }[] = [
	{ label: 'Customer', value: 'customer' },
	{ label: 'Custom contact', value: 'custom' },
];

/**
 * The Agent Tester's "new session" dialog: pick a channel, then either a CRM
 * customer to impersonate or an arbitrary contact address — the latter is how
 * staff exercise the unknown-sender signup flow. Mirrors the app's other modal
 * sheets (see `InviteCreatedModal`).
 */
export function NewSessionModal({
	open,
	onClose,
	onCreated,
}: {
	open: boolean;
	onClose: () => void;
	onCreated: (session: TesterSession) => void;
}) {
	const { session, client } = useAuth();
	// Key the roster fetch on the active company (and credential) rather than the
	// whole session object, which is replaced whenever any part of it changes —
	// that would re-run the reset effect and wipe a half-filled form.
	const accountId = session?.account.id ?? '';
	/** Empty on web, where the HttpOnly session cookie is the credential. */
	const token = session?.token ?? '';

	const [channel, setChannel] = useState<TesterChannel>('email');
	const [mode, setMode] = useState<Mode>('customer');
	const [query, setQuery] = useState('');
	const [customers, setCustomers] = useState<Customer[]>([]);
	const [loadingCustomers, setLoadingCustomers] = useState(false);
	const [results, setResults] = useState<Customer[]>([]);
	const [searching, setSearching] = useState(false);
	// The picked customer itself, not just an id: a match found by search isn't on
	// the browse page, so there'd be nothing to look the id up in.
	const [selected, setSelected] = useState<Customer | null>(null);
	const [address, setAddress] = useState('');
	const [name, setName] = useState('');
	const [subject, setSubject] = useState('');
	const [creating, setCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const loadCustomers = useCallback(
		async (isActive: () => boolean = () => true) => {
			if (!accountId) {
				return;
			}
			setLoadingCustomers(true);
			try {
				const { data } = await client.listCustomers(token, { pageSize: CUSTOMER_PAGE_SIZE });
				if (isActive()) {
					setCustomers(data);
				}
			} catch {
				// The picker degrades to the custom-contact path, which needs no CRM.
				if (isActive()) {
					setCustomers([]);
				}
			} finally {
				if (isActive()) {
					setLoadingCustomers(false);
				}
			}
		},
		[client, token, accountId],
	);

	// Start from a clean sheet every time it opens, and refresh the roster so a
	// customer added since the last open is pickable.
	useEffect(() => {
		if (!open) {
			return;
		}
		setChannel('email');
		setMode('customer');
		setQuery('');
		setSelected(null);
		setAddress('');
		setName('');
		setSubject('');
		setError(null);
		let active = true;
		void loadCustomers(() => active);
		return () => {
			active = false;
		};
	}, [open, loadCustomers]);

	const term = query.trim();
	/** Bumped per search so a slow response can't overwrite a newer one's results. */
	const searchSeq = useRef(0);

	// A typed term is searched *server-side* (`/v1/search` matches name, email,
	// phone, address and notes): page one is only the first hundred customers, so
	// filtering it locally would silently hide every older customer from the picker.
	useEffect(() => {
		if (!open || mode !== 'customer' || term === '') {
			// Nothing to search — and whatever was in flight is now stale.
			searchSeq.current += 1;
			setResults([]);
			setSearching(false);
			return;
		}
		const seq = searchSeq.current + 1;
		searchSeq.current = seq;
		setSearching(true);
		const timer = setTimeout(() => {
			void (async () => {
				try {
					const found = await client.search(token, { q: term, limit: SEARCH_LIMIT });
					if (searchSeq.current === seq) {
						setResults(found.customers);
					}
				} catch {
					// A failed search reads as "no matches"; the custom-contact path, which
					// needs no CRM at all, still works.
					if (searchSeq.current === seq) {
						setResults([]);
					}
				} finally {
					if (searchSeq.current === seq) {
						setSearching(false);
					}
				}
			})();
		}, SEARCH_DEBOUNCE_MS);
		return () => {
			clearTimeout(timer);
		};
	}, [open, mode, term, client, token]);

	// No term: the browse page. A term: whatever the server matched.
	const browsing = term === '';
	const rows = browsing ? customers : results;
	const rowsLoading = browsing ? loadingCustomers : searching;
	// The search returns at most `SEARCH_LIMIT` customers, so a full set almost
	// certainly has more behind it — say so rather than looking like the whole answer.
	const capped = !browsing && results.length >= SEARCH_LIMIT;

	// A customer with no address on the chosen channel can't be impersonated there,
	// so switching channels can invalidate an existing pick.
	const selectedUsable = selected !== null && addressFor(selected, channel) !== '';
	const ready = mode === 'customer' ? selectedUsable : address.trim() !== '';

	async function onCreate() {
		if (creating || !ready) {
			return;
		}
		setError(null);
		setCreating(true);
		try {
			const created = await client.createTesterSession(token, {
				channel,
				...(mode === 'customer'
					? { customerId: selected?.id ?? '' }
					: { contactAddress: address, contactName: name }),
				...(channel === 'email' ? { subject } : {}),
			});
			onCreated(created);
		} catch (caught) {
			// A 409 (this contact already has a session on this channel) carries the
			// API's own wording — show it verbatim rather than a generic failure.
			setError(
				caught instanceof ApiError || caught instanceof Error
					? caught.message
					: 'Could not start the session.',
			);
		} finally {
			setCreating(false);
		}
	}

	return (
		<Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
			<Pressable style={styles.backdrop} onPress={onClose}>
				<Pressable style={styles.sheet} onPress={() => {}}>
					<Pressable
						onPress={onClose}
						accessibilityRole="button"
						accessibilityLabel="Close"
						style={styles.close}
					>
						<Feather name="x" size={18} color={colors.textMuted} />
					</Pressable>

					<BrandGradient style={styles.badge}>
						<Feather name="message-square" size={22} color="#fff" />
					</BrandGradient>

					<Txt style={styles.title}>New tester session</Txt>
					<Txt style={styles.subtitle}>
						Choose who you’ll write in as, and the channel they’d reach Rivus on. Nothing is
						delivered — the agent’s reply comes straight back to you.
					</Txt>

					<ScrollView
						style={styles.body}
						contentContainerStyle={styles.bodyContent}
						keyboardShouldPersistTaps="handled"
					>
						<View style={styles.field}>
							<Txt style={styles.fieldLabel}>Channel</Txt>
							<Segmented options={CHANNEL_OPTIONS} value={channel} onChange={setChannel} />
						</View>

						<View style={styles.field}>
							<Txt style={styles.fieldLabel}>Impersonate</Txt>
							<Segmented options={MODE_OPTIONS} value={mode} onChange={setMode} />
						</View>

						{mode === 'customer' ? (
							<View style={styles.field}>
								<TextField
									label="Find a customer"
									value={query}
									onChangeText={setQuery}
									placeholder="Search by name, email or phone"
									autoCapitalize="none"
									autoCorrect={false}
								/>
								{capped ? (
									<Txt style={styles.pickerNote}>
										Showing the closest matches — keep typing to narrow them down.
									</Txt>
								) : null}
								{/* A pick made from a search stays picked once the term changes, but
								    the row that showed the tick may no longer be listed — name it. */}
								{selected && !rows.some((customer) => customer.id === selected.id) ? (
									<Txt style={styles.pickerNote}>Writing as {selected.name}.</Txt>
								) : null}
								<View style={styles.picker}>
									{rowsLoading ? (
										<ActivityIndicator color={colors.brandPurple} style={styles.pickerLoading} />
									) : rows.length === 0 ? (
										<Txt style={styles.pickerEmpty}>
											{browsing
												? 'No customers yet — use a custom contact instead.'
												: 'No customers match that search.'}
										</Txt>
									) : (
										// Rendered inline (not in its own ScrollView): the sheet's body
										// already scrolls, and nesting two vertical scrollers fights for
										// the same gesture on native.
										rows.map((customer) => {
											const hint = missingAddressHint(customer, channel);
											const active = customer.id === selected?.id;
											return (
												<Pressable
													key={customer.id}
													onPress={() => setSelected(customer)}
													disabled={hint !== ''}
													accessibilityRole="button"
													accessibilityState={{ selected: active, disabled: hint !== '' }}
													style={[
														styles.customerRow,
														active && styles.customerRowActive,
														hint !== '' && styles.customerRowDisabled,
													]}
												>
													<Avatar initials={initialsOf(customer.name)} size={30} />
													<View style={styles.customerText}>
														<Txt style={styles.customerName} numberOfLines={1}>
															{customer.name}
														</Txt>
														<Txt
															style={hint ? styles.customerHint : styles.customerAddress}
															numberOfLines={1}
														>
															{hint || addressFor(customer, channel)}
														</Txt>
													</View>
													{active ? (
														<Feather name="check" size={16} color={colors.brandPurple} />
													) : null}
												</Pressable>
											);
										})
									)}
								</View>
							</View>
						) : (
							<>
								<TextField
									label={channel === 'email' ? 'Email address' : 'Phone number'}
									value={address}
									onChangeText={setAddress}
									placeholder={addressPlaceholder(channel)}
									autoCapitalize="none"
									autoCorrect={false}
									keyboardType={channel === 'email' ? 'email-address' : 'phone-pad'}
									hint="An address the CRM doesn’t know is how you test the sign-up flow."
								/>
								<TextField
									label="Contact name (optional)"
									value={name}
									onChangeText={setName}
									placeholder="Dana Whitfield"
									autoCapitalize="words"
								/>
							</>
						)}

						{channel === 'email' ? (
							<TextField
								label="Subject (optional)"
								value={subject}
								onChangeText={setSubject}
								placeholder="Water heater is leaking"
							/>
						) : null}
					</ScrollView>

					{error ? <Txt style={styles.errorTxt}>{error}</Txt> : null}

					<GradientButton
						label={creating ? 'Starting…' : 'Start session'}
						icon="plus"
						loading={creating}
						disabled={!ready}
						onPress={onCreate}
						style={styles.submit}
					/>
				</Pressable>
			</Pressable>
		</Modal>
	);
}

const styles = StyleSheet.create({
	backdrop: {
		flex: 1,
		backgroundColor: 'rgba(15,15,25,0.45)',
		justifyContent: 'center',
		alignItems: 'center',
		padding: 20,
	},
	sheet: {
		width: '100%',
		maxWidth: 440,
		maxHeight: '90%',
		backgroundColor: colors.surface,
		borderRadius: radii.card,
		padding: 24,
		gap: 12,
		...shadowSoft,
	},
	close: {
		position: 'absolute',
		top: 14,
		right: 14,
		padding: 4,
		borderRadius: radii.sm,
		zIndex: 1,
	},
	badge: {
		width: 52,
		height: 52,
		borderRadius: radii.xl,
		alignItems: 'center',
		justifyContent: 'center',
	},
	title: {
		fontFamily: font.semibold,
		fontSize: 19,
		color: colors.text,
	},
	subtitle: {
		fontFamily: font.regular,
		fontSize: 13.5,
		lineHeight: 20,
		color: colors.textMuted,
		marginTop: -4,
	},
	body: {
		flexGrow: 0,
	},
	bodyContent: {
		gap: 14,
		paddingBottom: 2,
	},
	field: {
		gap: 6,
	},
	fieldLabel: {
		fontFamily: font.semibold,
		fontSize: 12.5,
		color: colors.textSub,
	},
	picker: {
		borderWidth: 1,
		borderColor: colors.borderField,
		borderRadius: radii.md,
		backgroundColor: colors.surfaceAlt,
		overflow: 'hidden',
	},
	pickerLoading: {
		paddingVertical: 22,
	},
	pickerEmpty: {
		fontFamily: font.regular,
		fontSize: 12.5,
		color: colors.textMuted,
		padding: 16,
		textAlign: 'center',
	},
	pickerNote: {
		fontFamily: font.medium,
		fontSize: 11.5,
		color: colors.textMuted,
	},
	customerRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 10,
		paddingVertical: 9,
		paddingHorizontal: 12,
	},
	customerRowActive: {
		backgroundColor: colors.surface,
	},
	customerRowDisabled: {
		opacity: 0.5,
	},
	customerText: {
		flex: 1,
		minWidth: 0,
	},
	customerName: {
		fontFamily: font.semibold,
		fontSize: 13,
		color: colors.text,
	},
	customerAddress: {
		fontFamily: font.regular,
		fontSize: 11.5,
		color: colors.textMuted,
	},
	customerHint: {
		fontFamily: font.medium,
		fontSize: 11.5,
		color: colors.textHint,
	},
	errorTxt: {
		fontFamily: font.medium,
		fontSize: 12.5,
		lineHeight: 18,
		color: colors.redInk,
	},
	submit: {
		marginTop: 2,
	},
});

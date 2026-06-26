import type { CustomerChannel, CustomerStatus } from '@rivus/core';
import { type ComponentProps, useCallback, useEffect, useMemo, useState } from 'react';
import {
	ActivityIndicator,
	Platform,
	Pressable,
	ScrollView,
	StyleSheet,
	useWindowDimensions,
	View,
} from 'react-native';
import { ApiError, type Customer } from '@/src/api/client';
import { getGoogleMapsApiKey } from '@/src/api/config';
import { initialsOf, useAuth } from '@/src/auth/AuthContext';
import { AddressAutocomplete } from '@/src/components/AddressAutocomplete';
import {
	Avatar,
	Card,
	GradientButton,
	Icon,
	OutlineButton,
	Pill,
	SectionLabel,
	Segmented,
	TextField,
	Txt,
} from '@/src/components/ui';
import { colors, font, radii, SIDEBAR_BREAKPOINT, SIDEBAR_WIDTH } from '@/src/theme/tokens';

const COLS = {
	customer: 2.2,
	address: 1.3,
	channel: 1,
	lifetime: 1,
	balance: 1.2,
	status: 1.1,
};

const CHANNEL_OPTIONS: { label: string; value: CustomerChannel }[] = [
	{ label: 'WhatsApp', value: 'whatsapp' },
	{ label: 'Phone', value: 'phone' },
	{ label: 'Email', value: 'email' },
	{ label: 'SMS', value: 'sms' },
];

const STATUS_OPTIONS: { label: string; value: CustomerStatus }[] = [
	{ label: 'Lead', value: 'lead' },
	{ label: 'Quote', value: 'quote' },
	{ label: 'Paid', value: 'paid' },
	{ label: 'Due', value: 'due' },
];

const CHANNEL_LABEL: Record<CustomerChannel, string> = {
	whatsapp: 'WhatsApp',
	phone: 'Phone',
	email: 'Email',
	sms: 'SMS',
};

const STATUS_STYLE: Record<CustomerStatus, { label: string; color: string; background: string }> = {
	paid: { label: 'Paid up', color: colors.green, background: 'rgba(31,181,115,0.12)' },
	due: { label: 'Balance due', color: colors.redInk, background: 'rgba(240,88,75,0.12)' },
	quote: { label: 'Quote pending', color: colors.amberInk, background: 'rgba(240,160,32,0.14)' },
	lead: { label: 'New lead', color: colors.brandPurple, background: 'rgba(110,30,200,0.10)' },
};

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
	// Accept digits with optional thousands separators and up to two decimals
	// (e.g. "1,234.56"); reject anything else so stray formatting like "$" isn't
	// coerced to 0 and "12.999" isn't silently rounded into a different amount.
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

export default function CustomersScreen() {
	const { session, client } = useAuth();
	const { width } = useWindowDimensions();
	const sidebar = width >= SIDEBAR_BREAKPOINT ? SIDEBAR_WIDTH : 0;
	const showPanel = width >= 1040;
	const panel = showPanel ? 340 : 0;
	const avail = width - sidebar - panel - 48;
	const tableWidth = Math.max(640, avail);

	const [list, setList] = useState<Customer[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);

	const [formOpen, setFormOpen] = useState(false);
	const [editing, setEditing] = useState<Customer | null>(null);
	const [name, setName] = useState('');
	const [email, setEmail] = useState('');
	const [phone, setPhone] = useState('');
	const [address, setAddress] = useState('');
	const [channel, setChannel] = useState<CustomerChannel>('phone');
	const [status, setStatus] = useState<CustomerStatus>('lead');
	const [lifetime, setLifetime] = useState('');
	const [balance, setBalance] = useState('');
	const [notes, setNotes] = useState('');
	const [formError, setFormError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [deleting, setDeleting] = useState(false);

	// The Google Maps key is HTTP-referrer restricted, which only authorizes web
	// origins, so gate address autocomplete to web and let the field fall back to a
	// plain text input on native — same as the signup form and account settings.
	const mapsApiKey = useMemo(() => (Platform.OS === 'web' ? getGoogleMapsApiKey() : null), []);

	const load = useCallback(
		async (isActive: () => boolean = () => true) => {
			if (!session) {
				return;
			}
			setLoading(true);
			setError(null);
			try {
				// The API caps pageSize at 100 and this screen has no pagination UI, so
				// page through everything — otherwise customers past the first 100 would
				// vanish from the list with no way to view or edit them. MAX_PAGES is a
				// backstop against an API that returns hasNextPage forever (far more than
				// this un-virtualized list will ever render).
				const all: Customer[] = [];
				const MAX_PAGES = 100;
				let page = 1;
				let hasNext = true;
				while (hasNext && page <= MAX_PAGES) {
					const { data, meta } = await client.listCustomers(session.token, { page, pageSize: 100 });
					all.push(...data);
					hasNext = meta.hasNextPage;
					page += 1;
				}
				// Ignore the result if the session/account changed mid-load (e.g. a staff
				// company switch) so we never paint one account's customers over another's.
				if (isActive()) {
					setList(all);
				}
			} catch (caught) {
				if (isActive()) {
					setError(caught instanceof ApiError ? caught.message : 'Could not load your customers.');
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

	function resetForm() {
		setName('');
		setEmail('');
		setPhone('');
		setAddress('');
		setChannel('phone');
		setStatus('lead');
		setLifetime('');
		setBalance('');
		setNotes('');
		setFormError(null);
	}

	function openCreate() {
		setEditing(null);
		resetForm();
		setFormOpen(true);
	}

	function openEdit(customer: Customer) {
		setEditing(customer);
		setName(customer.name);
		setEmail(customer.email);
		setPhone(customer.phone);
		setAddress(customer.address);
		setChannel(customer.channel);
		setStatus(customer.status);
		setLifetime(centsToInput(customer.lifetimeValue));
		setBalance(centsToInput(customer.balance));
		setNotes(customer.notes);
		setFormError(null);
		setSelectedId(customer.id);
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
		const lifetimeValue = dollarsToCents(lifetime);
		const balanceValue = dollarsToCents(balance);
		if (lifetimeValue === null || balanceValue === null) {
			setFormError('Enter a valid, non-negative amount for the money fields.');
			return;
		}
		setFormError(null);
		setSaving(true);
		try {
			const input = {
				name: name.trim(),
				email: email.trim(),
				phone: phone.trim(),
				address: address.trim(),
				channel,
				status,
				lifetimeValue,
				balance: balanceValue,
				notes: notes.trim(),
			};
			const saved = editing
				? await client.updateCustomer(session.token, editing.id, input)
				: await client.createCustomer(session.token, input);
			setSelectedId(saved.id);
			closeForm();
			await load();
		} catch (caught) {
			setFormError(caught instanceof Error ? caught.message : 'Could not save the customer.');
		} finally {
			setSaving(false);
		}
	}

	async function onDelete() {
		if (!session || !editing || deleting) {
			return;
		}
		setFormError(null);
		setDeleting(true);
		try {
			await client.deleteCustomer(session.token, editing.id);
			if (selectedId === editing.id) {
				setSelectedId(null);
			}
			closeForm();
			await load();
		} catch (caught) {
			setFormError(caught instanceof ApiError ? caught.message : 'Could not delete the customer.');
		} finally {
			setDeleting(false);
		}
	}

	if (!session) {
		return null;
	}

	const selected = list.find((customer) => customer.id === selectedId) ?? list[0] ?? null;
	const countLabel = `${list.length} ${list.length === 1 ? 'contact' : 'contacts'}`;

	return (
		<View style={styles.row}>
			<ScrollView style={{ flex: 1 }} contentContainerStyle={styles.leftPad}>
				<View style={styles.head}>
					<View>
						<Txt style={styles.title}>Customers</Txt>
						<Txt style={styles.subtitle}>{countLabel}</Txt>
					</View>
					<GradientButton label="Add customer" icon="plus" onPress={openCreate} />
				</View>

				{formOpen ? (
					<Card style={styles.form}>
						<View style={styles.formHead}>
							<Txt style={styles.formTitle}>{editing ? 'Edit customer' : 'New customer'}</Txt>
							<Pressable onPress={closeForm} accessibilityRole="button">
								<Icon name="x" size={18} color={colors.textMuted} />
							</Pressable>
						</View>
						<TextField
							label="Name"
							value={name}
							onChangeText={setName}
							placeholder="Grace Kim"
							autoCapitalize="words"
						/>
						<View style={styles.formRow}>
							<View style={styles.formCol}>
								<TextField
									label="Email"
									value={email}
									onChangeText={setEmail}
									placeholder="grace@example.com"
									autoCapitalize="none"
									keyboardType="email-address"
								/>
							</View>
							<View style={styles.formCol}>
								<TextField
									label="Phone"
									value={phone}
									onChangeText={setPhone}
									placeholder="(206) 555-0155"
									keyboardType="phone-pad"
								/>
							</View>
						</View>
						<AddressAutocomplete
							label="Address"
							value={address}
							onChangeText={setAddress}
							placeholder="1 Main St, Seattle, WA"
							apiKey={mapsApiKey}
						/>
						<View style={styles.fieldWrap}>
							<Txt style={styles.fieldLabel}>Channel</Txt>
							<Segmented options={CHANNEL_OPTIONS} value={channel} onChange={setChannel} />
						</View>
						<View style={styles.fieldWrap}>
							<Txt style={styles.fieldLabel}>Status</Txt>
							<Segmented options={STATUS_OPTIONS} value={status} onChange={setStatus} />
						</View>
						<View style={styles.formRow}>
							<View style={styles.formCol}>
								<TextField
									label="Lifetime value ($)"
									value={lifetime}
									onChangeText={setLifetime}
									placeholder="0.00"
									keyboardType="decimal-pad"
								/>
							</View>
							<View style={styles.formCol}>
								<TextField
									label="Balance ($)"
									value={balance}
									onChangeText={setBalance}
									placeholder="0.00"
									keyboardType="decimal-pad"
								/>
							</View>
						</View>
						<TextField
							label="Notes"
							value={notes}
							onChangeText={setNotes}
							placeholder="Repeat client · membership"
							multiline
							style={styles.notesInput}
						/>

						{formError ? <Txt style={styles.errorTxt}>{formError}</Txt> : null}

						<View style={styles.btnRow}>
							<GradientButton
								label={saving ? 'Saving…' : editing ? 'Save changes' : 'Add customer'}
								icon="check"
								onPress={onSave}
								style={styles.btnGrow}
							/>
							<OutlineButton label="Cancel" onPress={closeForm} style={styles.btnGrow} />
						</View>
						{editing ? (
							<OutlineButton
								label={deleting ? 'Deleting…' : 'Delete customer'}
								onPress={onDelete}
								style={styles.deleteBtn}
							/>
						) : null}
					</Card>
				) : null}

				{loading ? (
					<ActivityIndicator color={colors.brandPurple} style={styles.loading} />
				) : error ? (
					<Txt style={styles.errorTxt}>{error}</Txt>
				) : list.length === 0 ? (
					<Txt style={styles.empty}>
						No customers yet. Add your first contact to start tracking jobs and balances.
					</Txt>
				) : (
					<ScrollView horizontal showsHorizontalScrollIndicator={false}>
						<View style={[styles.table, { width: tableWidth }]}>
							<View style={styles.tableHead}>
								<Txt style={[styles.th, { flex: COLS.customer }]}>Customer</Txt>
								<Txt style={[styles.th, { flex: COLS.address }]}>Address</Txt>
								<Txt style={[styles.th, { flex: COLS.channel }]}>Channel</Txt>
								<Txt style={[styles.th, styles.right, { flex: COLS.lifetime }]}>Lifetime</Txt>
								<Txt style={[styles.th, styles.right, { flex: COLS.balance }]}>Balance</Txt>
								<Txt style={[styles.th, styles.right, { flex: COLS.status }]}>Status</Txt>
								<View style={styles.editCol} />
							</View>
							{list.map((customer, index) => {
								const st = STATUS_STYLE[customer.status];
								const isSelected = customer.id === selected?.id;
								return (
									<Pressable
										key={customer.id}
										onPress={() => setSelectedId(customer.id)}
										style={[
											styles.tr,
											index === list.length - 1 && styles.trLast,
											isSelected && styles.trSelected,
										]}
									>
										<View style={[styles.cell, styles.customerCell, { flex: COLS.customer }]}>
											<Avatar initials={initialsOf(customer.name)} size={36} />
											<Txt style={styles.customerName} numberOfLines={1}>
												{customer.name}
											</Txt>
										</View>
										<Txt style={[styles.td, { flex: COLS.address }]} numberOfLines={1}>
											{customer.address || '—'}
										</Txt>
										<Txt style={[styles.td, { flex: COLS.channel }]}>
											{CHANNEL_LABEL[customer.channel]}
										</Txt>
										<Txt style={[styles.td, styles.right, styles.tdMed, { flex: COLS.lifetime }]}>
											{formatMoney(customer.lifetimeValue)}
										</Txt>
										<Txt style={[styles.td, styles.right, styles.tdBold, { flex: COLS.balance }]}>
											{formatMoney(customer.balance)}
										</Txt>
										<View style={[styles.cell, styles.statusCell, { flex: COLS.status }]}>
											<Pill label={st.label} color={st.color} background={st.background} />
										</View>
										<Pressable
											style={styles.editCol}
											onPress={() => openEdit(customer)}
											accessibilityRole="button"
										>
											<Icon name="edit-3" size={16} color={colors.textFaint} />
										</Pressable>
									</Pressable>
								);
							})}
						</View>
					</ScrollView>
				)}
			</ScrollView>

			{showPanel && selected ? (
				<AccountPanel customer={selected} onEdit={() => openEdit(selected)} />
			) : null}
		</View>
	);
}

function ContactRow({
	icon,
	label,
	value,
}: {
	icon: ComponentProps<typeof Icon>['name'];
	label: string;
	value: string;
}) {
	return (
		<View style={styles.contactRow}>
			<Icon name={icon} size={15} color={colors.textMuted} />
			<View style={{ flex: 1 }}>
				<Txt style={styles.contactLabel}>{label}</Txt>
				<Txt style={styles.contactValue}>{value}</Txt>
			</View>
		</View>
	);
}

function AccountPanel({ customer, onEdit }: { customer: Customer; onEdit: () => void }) {
	const st = STATUS_STYLE[customer.status];
	const since = new Date(customer.createdAt).getFullYear();
	return (
		<ScrollView style={styles.panel} contentContainerStyle={styles.panelPad}>
			<SectionLabel style={{ marginBottom: 14 }}>Account</SectionLabel>
			<View style={styles.acctHead}>
				<Avatar initials={initialsOf(customer.name)} size={50} />
				<View style={{ flex: 1 }}>
					<Txt style={styles.acctName}>{customer.name}</Txt>
					<Txt style={styles.acctSub}>
						{customer.address ? `${customer.address} · ` : ''}Customer since {since}
					</Txt>
				</View>
			</View>

			<View style={styles.pillRow}>
				<Pill label={st.label} color={st.color} background={st.background} />
			</View>

			<View style={styles.billCard}>
				<View style={styles.balanceRow}>
					<Txt style={styles.muted}>Balance due</Txt>
					<Txt
						style={[
							styles.balanceAmt,
							{ color: customer.balance > 0 ? colors.redInk : colors.green },
						]}
					>
						{formatMoney(customer.balance)}
					</Txt>
				</View>
				<View style={styles.ltvRow}>
					<Txt style={styles.muted}>Lifetime value</Txt>
					<Txt style={styles.ltvAmt}>{formatMoney(customer.lifetimeValue)}</Txt>
				</View>
			</View>

			<SectionLabel style={{ marginTop: 8, marginBottom: 12 }}>Contact</SectionLabel>
			<View style={{ gap: 12 }}>
				<ContactRow
					icon="message-circle"
					label="Preferred channel"
					value={CHANNEL_LABEL[customer.channel]}
				/>
				{customer.email ? <ContactRow icon="mail" label="Email" value={customer.email} /> : null}
				{customer.phone ? <ContactRow icon="phone" label="Phone" value={customer.phone} /> : null}
			</View>

			{customer.notes ? (
				<>
					<SectionLabel style={{ marginTop: 22, marginBottom: 10 }}>Notes</SectionLabel>
					<Txt style={styles.notesTxt}>{customer.notes}</Txt>
				</>
			) : null}

			<OutlineButton label="Edit customer" onPress={onEdit} style={styles.panelEdit} />
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

	// Form
	form: { gap: 14, marginBottom: 22 },
	formHead: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
	},
	formTitle: { fontFamily: font.semibold, fontSize: 15, color: colors.text },
	formRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
	formCol: { flexGrow: 1, flexBasis: 180 },
	fieldWrap: { gap: 6 },
	fieldLabel: { fontFamily: font.semibold, fontSize: 12.5, color: colors.textSub },
	notesInput: { minHeight: 80, textAlignVertical: 'top' },
	btnRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
	btnGrow: { flexGrow: 1, flexBasis: 140 },
	deleteBtn: { borderColor: 'rgba(240,88,75,0.4)' },

	loading: { paddingVertical: 24 },
	empty: { fontFamily: font.regular, fontSize: 13, color: colors.textMuted, paddingVertical: 16 },

	table: {
		backgroundColor: colors.surface,
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: radii.xxl,
		overflow: 'hidden',
	},
	tableHead: {
		flexDirection: 'row',
		alignItems: 'center',
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
	trSelected: { backgroundColor: 'rgba(110,30,200,0.05)' },
	cell: { flexDirection: 'row', alignItems: 'center' },
	customerCell: { gap: 12 },
	customerName: { fontFamily: font.medium, fontSize: 13.5, flex: 1 },
	td: { fontFamily: font.regular, fontSize: 13, color: colors.textSub },
	tdMed: { fontFamily: font.medium, color: colors.text },
	tdBold: { fontFamily: font.semibold, color: colors.text },
	statusCell: { justifyContent: 'flex-end' },
	editCol: { width: 30, alignItems: 'flex-end' },

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
	acctHead: { flexDirection: 'row', alignItems: 'center', gap: 13, marginBottom: 14 },
	acctName: { fontFamily: font.semibold, fontSize: 16 },
	acctSub: { fontFamily: font.regular, fontSize: 12.5, color: colors.textMuted },
	pillRow: { marginBottom: 14 },
	billCard: {
		backgroundColor: colors.surface,
		borderWidth: 1,
		borderColor: '#eaecf2',
		borderRadius: radii.xl,
		padding: 16,
		marginBottom: 14,
		gap: 12,
	},
	muted: { fontFamily: font.regular, fontSize: 12.5, color: colors.textMuted },
	balanceRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
	balanceAmt: { fontFamily: font.semibold, fontSize: 22 },
	ltvRow: {
		flexDirection: 'row',
		alignItems: 'baseline',
		justifyContent: 'space-between',
		borderTopWidth: 1,
		borderTopColor: '#f0f1f5',
		paddingTop: 12,
	},
	ltvAmt: { fontFamily: font.semibold, fontSize: 15, color: colors.text },
	contactRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
	contactLabel: { fontFamily: font.regular, fontSize: 11, color: colors.textFaint },
	contactValue: { fontFamily: font.medium, fontSize: 13, color: colors.text, marginTop: 1 },
	notesTxt: { fontFamily: font.regular, fontSize: 12.5, color: colors.textSub, lineHeight: 19 },
	panelEdit: { marginTop: 22 },
	errorTxt: { fontFamily: font.medium, fontSize: 12.5, color: colors.redInk },
});

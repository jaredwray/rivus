import { useCallback, useEffect, useMemo, useState } from 'react';
import {
	ActivityIndicator,
	Platform,
	ScrollView,
	StyleSheet,
	useWindowDimensions,
	View,
} from 'react-native';
import { ApiError, type Billing, type SeedSummary } from '@/src/api/client';
import { getGoogleMapsApiKey, isSeedingEnabled } from '@/src/api/config';
import { deviceTimezone, listTimezones } from '@/src/api/timezones';
import { useAuth } from '@/src/auth/AuthContext';
import { AddressAutocomplete } from '@/src/components/AddressAutocomplete';
import {
	Card,
	GradientButton,
	OutlineButton,
	Pill,
	SectionLabel,
	Select,
	TextField,
	Txt,
} from '@/src/components/ui';
import { colors, font } from '@/src/theme/tokens';

const PLAN_LABELS: Record<Billing['plan'], string> = {
	free: 'Free',
};

function messageFor(error: unknown, fallback: string): string {
	if (error instanceof ApiError || error instanceof Error) {
		return error.message;
	}
	return fallback;
}

/**
 * A development-only, Rivus-staff-only affordance to fill the current account with
 * demo data (customers, FAQs, appointments, notifications, and inbox
 * conversations) so there's something to test against. It self-gates on
 * {@link isSeedingEnabled} plus staff status and renders nothing otherwise — the
 * API enforces the same rules server-side (the seed route exists only on a dev
 * build or the deployed `development` environment, and rejects non-staff
 * callers), so this is purely about not showing a control that wouldn't work.
 */
function DevSeedCard() {
	const { session, client, isStaff } = useAuth();
	const [seeding, setSeeding] = useState(false);
	const [summary, setSummary] = useState<SeedSummary | null>(null);
	const [error, setError] = useState<string | null>(null);

	const visible = Boolean(session) && isStaff && isSeedingEnabled();

	async function onSeed() {
		if (seeding || !session) {
			return;
		}
		setError(null);
		setSummary(null);
		setSeeding(true);
		try {
			const result = await client.seedAccount(session.token);
			setSummary(result);
		} catch (caught) {
			setError(messageFor(caught, 'Could not seed the account.'));
		} finally {
			setSeeding(false);
		}
	}

	if (!visible || !session) {
		return null;
	}

	return (
		<Card style={[styles.card, styles.devCard]}>
			<SectionLabel style={styles.devLabel}>Developer · seed account</SectionLabel>
			<Txt style={styles.rowSub}>
				Fill {session.account.name} with demo customers, FAQs, appointments, notifications, and
				inbox conversations so you have realistic data to test against. Visible only in development,
				to Rivus staff.
			</Txt>

			{error ? <Txt style={styles.errorTxt}>{error}</Txt> : null}
			{summary ? (
				<Txt style={styles.savedTxt}>
					Seeded {summary.customers} customers, {summary.faqs} FAQs, {summary.appointments}{' '}
					appointments, {summary.notifications} notifications, and {summary.conversations}{' '}
					conversations.
				</Txt>
			) : null}

			<GradientButton
				label={seeding ? 'Seeding…' : 'Seed this account'}
				icon="database"
				onPress={onSeed}
			/>
		</Card>
	);
}

export default function SettingsScreen() {
	const { session, client, updateAccount, cancelAccount } = useAuth();
	const account = session?.account;
	const isOwner = session?.role === 'owner';
	// Stack the danger-zone buttons once the row is too narrow to hold both
	// without wrapping their labels.
	const { width } = useWindowDimensions();
	const narrow = width < 520;

	const [businessName, setBusinessName] = useState(account?.name ?? '');
	const [phone, setPhone] = useState(account?.phone ?? '');
	const [address, setAddress] = useState(account?.address ?? '');
	const [website, setWebsite] = useState(account?.website ?? '');
	const [timezone, setTimezone] = useState(account?.timezone || deviceTimezone());

	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [confirmingCancel, setConfirmingCancel] = useState(false);
	const [canceling, setCanceling] = useState(false);
	const [cancelError, setCancelError] = useState<string | null>(null);

	// Billing now lives here as a section rather than its own screen. Only Owners
	// can read it (the API rejects everyone else), so non-owners never load it.
	const [billing, setBilling] = useState<Billing | null>(null);
	const [billingLoading, setBillingLoading] = useState(true);
	const [billingError, setBillingError] = useState<string | null>(null);

	const timezoneOptions = useMemo(
		() => listTimezones().map((zone) => ({ label: zone.replace(/_/g, ' '), value: zone })),
		[],
	);

	// The Maps key is HTTP-referrer restricted to web origins, so native requests
	// (no referer) would be rejected on every keystroke. Gate autocomplete to web
	// and let the field fall back to a plain text input elsewhere — same as the
	// signup form (see AuthScreen).
	const mapsApiKey = useMemo(() => (Platform.OS === 'web' ? getGoogleMapsApiKey() : null), []);

	const loadBilling = useCallback(
		async (isActive: () => boolean) => {
			if (!session || !isOwner) {
				setBillingLoading(false);
				return;
			}
			setBillingLoading(true);
			setBillingError(null);
			try {
				const summary = await client.getBilling(session.token);
				// Bail if the screen unmounted or the session changed mid-request, so a
				// stale response can't overwrite newer state (mirrors the home screen).
				if (isActive()) {
					setBilling(summary);
				}
			} catch (caught) {
				if (isActive()) {
					setBillingError(messageFor(caught, 'Could not load billing.'));
				}
			} finally {
				if (isActive()) {
					setBillingLoading(false);
				}
			}
		},
		[client, session, isOwner],
	);

	useEffect(() => {
		let active = true;
		loadBilling(() => active);
		return () => {
			active = false;
		};
	}, [loadBilling]);

	if (!session) {
		return null;
	}

	if (!isOwner) {
		return (
			<ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
				<Txt style={styles.h1}>Account settings</Txt>
				<Card style={styles.card}>
					<Txt style={styles.rowSub}>
						Only the account Owner can change account settings or billing. Ask an Owner if you need
						something updated.
					</Txt>
				</Card>
				<DevSeedCard />
			</ScrollView>
		);
	}

	async function onSave() {
		if (saving) {
			return;
		}
		setError(null);
		setSaved(false);
		setSaving(true);
		try {
			await updateAccount({
				businessName: businessName.trim(),
				phone: phone.trim(),
				address: address.trim(),
				website: website.trim(),
				timezone: timezone.trim(),
			});
			setSaved(true);
		} catch (caught) {
			setError(messageFor(caught, 'Could not save your changes.'));
		} finally {
			setSaving(false);
		}
	}

	async function onCancelAccount() {
		if (canceling) {
			return;
		}
		setCancelError(null);
		setCanceling(true);
		try {
			// On success the session is cleared and this screen unmounts back to sign-in.
			await cancelAccount();
		} catch (caught) {
			setCancelError(messageFor(caught, 'Could not cancel the account.'));
			setCanceling(false);
		}
	}

	return (
		<ScrollView
			contentContainerStyle={styles.content}
			keyboardShouldPersistTaps="handled"
			showsVerticalScrollIndicator={false}
		>
			<Txt style={styles.h1}>Account settings</Txt>

			<Card style={styles.card}>
				<SectionLabel>Business information</SectionLabel>
				<View style={styles.form}>
					<TextField
						label="Business name"
						value={businessName}
						onChangeText={(next) => {
							setBusinessName(next);
							setSaved(false);
						}}
						placeholder="Cascade Plumbing & Heating"
						autoCapitalize="words"
					/>
					<TextField
						label="Phone"
						value={phone}
						onChangeText={setPhone}
						placeholder="+1 (206) 555-0100"
						keyboardType="phone-pad"
					/>
					<AddressAutocomplete
						label="Address"
						value={address}
						onChangeText={setAddress}
						placeholder="1 Main St, Seattle, WA"
						apiKey={mapsApiKey}
					/>
					<TextField
						label="Website"
						value={website}
						onChangeText={setWebsite}
						placeholder="https://yourbusiness.com"
						autoCapitalize="none"
						keyboardType="url"
					/>
					<Select
						label="Time zone"
						value={timezone}
						onSelect={setTimezone}
						options={timezoneOptions}
						searchable
					/>

					{error ? <Txt style={styles.errorTxt}>{error}</Txt> : null}
					{saved ? <Txt style={styles.savedTxt}>Saved.</Txt> : null}

					<GradientButton
						label={saving ? 'Saving…' : 'Save changes'}
						icon="check"
						onPress={onSave}
					/>
				</View>
			</Card>

			<Card style={styles.card}>
				<SectionLabel>Plan &amp; billing</SectionLabel>
				{billingLoading ? (
					<ActivityIndicator color={colors.brandPurple} style={styles.billingLoading} />
				) : billingError ? (
					<Txt style={styles.errorTxt}>{billingError}</Txt>
				) : billing ? (
					<>
						<View style={styles.planRow}>
							<Txt style={styles.plan}>{PLAN_LABELS[billing.plan]}</Txt>
							<Pill
								label={billing.status === 'active' ? 'Active' : 'Canceled'}
								color={colors.brandPurpleInk}
								background="rgba(110,30,200,0.08)"
							/>
						</View>
						<View style={styles.statRow}>
							<Txt style={styles.statLabel}>Seats in use</Txt>
							<Txt style={styles.statValue}>{billing.seats}</Txt>
						</View>
						<Txt style={styles.note}>
							Paid plans aren’t available yet — every account is on the free plan while we finish
							wiring up billing.
						</Txt>
					</>
				) : null}
			</Card>

			<Card style={[styles.card, styles.dangerCard]}>
				<SectionLabel style={styles.dangerLabel}>Danger zone</SectionLabel>
				<Txt style={styles.rowSub}>
					Canceling closes {session.account.name} for everyone. Your data is retained but the
					account is locked and all members are signed out. This can only be undone by contacting
					support.
				</Txt>

				{cancelError ? <Txt style={styles.errorTxt}>{cancelError}</Txt> : null}

				{confirmingCancel ? (
					<View style={[styles.confirmRow, narrow && styles.confirmRowNarrow]}>
						<GradientButton
							label={canceling ? 'Canceling…' : 'Yes, cancel account'}
							icon="alert-triangle"
							onPress={onCancelAccount}
							style={[styles.confirmBtn, narrow && styles.confirmBtnNarrow]}
						/>
						<OutlineButton
							label="Keep account"
							onPress={() => setConfirmingCancel(false)}
							style={[styles.confirmBtn, narrow && styles.confirmBtnNarrow]}
						/>
					</View>
				) : (
					<OutlineButton
						label="Cancel account"
						onPress={() => setConfirmingCancel(true)}
						style={styles.dangerBtn}
					/>
				)}
			</Card>

			<DevSeedCard />
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	content: {
		padding: 26,
		gap: 16,
		maxWidth: 760,
		width: '100%',
		alignSelf: 'center',
	},
	h1: {
		fontFamily: font.bold,
		fontSize: 22,
		color: colors.text,
	},
	card: {
		gap: 12,
	},
	form: {
		gap: 13,
	},
	rowSub: {
		fontFamily: font.regular,
		fontSize: 12.5,
		color: colors.textMuted,
	},
	errorTxt: {
		fontFamily: font.medium,
		fontSize: 12.5,
		color: colors.redInk,
	},
	savedTxt: {
		fontFamily: font.medium,
		fontSize: 12.5,
		color: colors.green,
	},
	billingLoading: {
		paddingVertical: 12,
	},
	planRow: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
	},
	plan: {
		fontFamily: font.bold,
		fontSize: 20,
		color: colors.text,
	},
	statRow: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		borderTopWidth: 1,
		borderTopColor: colors.border,
		paddingTop: 12,
	},
	statLabel: {
		fontFamily: font.regular,
		fontSize: 13,
		color: colors.textMuted,
	},
	statValue: {
		fontFamily: font.semibold,
		fontSize: 15,
		color: colors.text,
	},
	note: {
		fontFamily: font.regular,
		fontSize: 12,
		color: colors.textFaint,
	},
	dangerCard: {
		borderColor: 'rgba(240,88,75,0.35)',
	},
	dangerLabel: {
		color: colors.redInk,
	},
	// A violet-tinted border marks the dev-only seeder as a distinct, internal tool
	// (mirrors how the danger zone is set apart), without using the signature gradient.
	devCard: {
		borderColor: 'rgba(110,30,200,0.30)',
	},
	devLabel: {
		color: colors.brandPurpleInk,
	},
	dangerBtn: {
		borderColor: 'rgba(240,88,75,0.45)',
	},
	confirmRow: {
		flexDirection: 'row',
		gap: 10,
	},
	confirmRowNarrow: {
		flexDirection: 'column',
	},
	// Stacked, the buttons size to their content; reset the row's flex:1 so they
	// don't try to distribute height in the column's unbounded vertical space.
	confirmBtnNarrow: {
		flex: 0,
	},
	confirmBtn: {
		flex: 1,
	},
});

import { useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { ApiError } from '@/src/api/client';
import { getGoogleMapsApiKey } from '@/src/api/config';
import { deviceTimezone, listTimezones } from '@/src/api/timezones';
import { useAuth } from '@/src/auth/AuthContext';
import { AddressAutocomplete } from '@/src/components/AddressAutocomplete';
import {
	Card,
	GradientButton,
	OutlineButton,
	SectionLabel,
	Select,
	TextField,
	Txt,
} from '@/src/components/ui';
import { colors, font } from '@/src/theme/tokens';

function messageFor(error: unknown, fallback: string): string {
	if (error instanceof ApiError || error instanceof Error) {
		return error.message;
	}
	return fallback;
}

export default function SettingsScreen() {
	const { session, updateAccount, cancelAccount } = useAuth();
	const account = session?.account;

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

	const timezoneOptions = useMemo(
		() => listTimezones().map((zone) => ({ label: zone.replace(/_/g, ' '), value: zone })),
		[],
	);

	// The Maps key is HTTP-referrer restricted to web origins, so native requests
	// (no referer) would be rejected on every keystroke. Gate autocomplete to web
	// and let the field fall back to a plain text input elsewhere — same as the
	// signup form (see AuthScreen).
	const mapsApiKey = useMemo(() => (Platform.OS === 'web' ? getGoogleMapsApiKey() : null), []);

	if (!session) {
		return null;
	}

	if (session.role !== 'owner') {
		return (
			<ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
				<Txt style={styles.h1}>Account settings</Txt>
				<Card style={styles.card}>
					<Txt style={styles.rowSub}>
						Only the account Owner can change account settings or billing. Ask an Owner if you need
						something updated.
					</Txt>
				</Card>
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
			<Txt style={styles.subtitle}>Business details for {session.account.name}.</Txt>

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

			<Card style={[styles.card, styles.dangerCard]}>
				<SectionLabel style={styles.dangerLabel}>Danger zone</SectionLabel>
				<Txt style={styles.rowSub}>
					Canceling closes {session.account.name} for everyone. Your data is retained but the
					account is locked and all members are signed out. This can only be undone by contacting
					support.
				</Txt>

				{cancelError ? <Txt style={styles.errorTxt}>{cancelError}</Txt> : null}

				{confirmingCancel ? (
					<View style={styles.confirmRow}>
						<GradientButton
							label={canceling ? 'Canceling…' : 'Yes, cancel account'}
							icon="alert-triangle"
							onPress={onCancelAccount}
							style={styles.confirmBtn}
						/>
						<OutlineButton
							label="Keep account"
							onPress={() => setConfirmingCancel(false)}
							style={styles.confirmBtn}
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
	subtitle: {
		fontFamily: font.regular,
		fontSize: 13.5,
		color: colors.textMuted,
		marginTop: -8,
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
	dangerCard: {
		borderColor: 'rgba(240,88,75,0.35)',
	},
	dangerLabel: {
		color: colors.redInk,
	},
	dangerBtn: {
		borderColor: 'rgba(240,88,75,0.45)',
	},
	confirmRow: {
		flexDirection: 'row',
		gap: 10,
	},
	confirmBtn: {
		flex: 1,
	},
});

import { gravatarUrl, type UpdateProfileInput } from '@rivus/core';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ApiError } from '@/src/api/client';
import { initialsOf, roleLabel, useAuth } from '@/src/auth/AuthContext';
import {
	Avatar,
	Card,
	GradientButton,
	OutlineButton,
	Pill,
	SectionLabel,
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

/**
 * The signed-in user's personal profile — name, contact phone, and sign-in email.
 * Available to every member (unlike account Settings, which is owner-only).
 *
 * Email is special: changing it doesn't take effect immediately. The API stages
 * the new address on `user.pendingEmail` and emails a one-time code; the live
 * email only switches once that code is confirmed below. While a change is
 * pending, a second card collects the code (with a resend).
 */
export default function ProfileScreen() {
	const { session, updateProfile, verifyEmailChange } = useAuth();
	const user = session?.user;

	const [name, setName] = useState(user?.name ?? '');
	const [phone, setPhone] = useState(user?.phone ?? '');
	const [email, setEmail] = useState(user?.email ?? '');
	const [avatarUrl, setAvatarUrl] = useState('');

	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [code, setCode] = useState('');
	const [verifying, setVerifying] = useState(false);
	const [verifyError, setVerifyError] = useState<string | null>(null);
	const [resent, setResent] = useState(false);

	// Re-sync the editable fields whenever the *server* values change (after a save,
	// or after a verified email change resets the live email and clears the pending
	// one). Local edits never change the server values until saved, so in-progress
	// typing is not clobbered. After an email change is staged, this resets the email
	// field to the still-current address while the pending card shows the new one.
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on server values only, by design
	useEffect(() => {
		if (!user) {
			return;
		}
		setName(user.name);
		setPhone(user.phone);
		setEmail(user.email);
		// `user.avatarUrl` is always a usable URL — a custom override, or the Gravatar
		// `toPublicUser` computed from the email when there's no override. The field
		// only edits the override, so an exact match against that computed default
		// (rather than just "looks like a Gravatar URL") is what tells "no override"
		// apart from "a custom image that happens to be hosted on gravatar.com" —
		// leaving the field blank doubles as "use my Gravatar" either way.
		setAvatarUrl(user.avatarUrl === gravatarUrl(user.email) ? '' : user.avatarUrl);
	}, [user?.name, user?.phone, user?.email, user?.pendingEmail, user?.avatarUrl]);

	if (!session || !user) {
		return null;
	}

	const pendingEmail = user.pendingEmail;
	const liveEmail = user.email;

	async function onSave() {
		if (saving || !user) {
			return;
		}
		setError(null);
		setSaved(false);
		// Send only the fields that actually changed (a partial update), mirroring the
		// account-settings form. An unchanged form is a no-op.
		const patch: UpdateProfileInput = {};
		const nextName = name.trim();
		const nextPhone = phone.trim();
		const nextEmail = email.trim().toLowerCase();
		const nextAvatarUrl = avatarUrl.trim();
		if (nextName !== user.name) {
			patch.name = nextName;
		}
		if (nextPhone !== user.phone) {
			patch.phone = nextPhone;
		}
		if (nextEmail !== user.email) {
			patch.email = nextEmail;
		}
		// Compare against the same computed default the field was pre-filled with (see
		// the sync effect above), not the raw `user.avatarUrl`, so an unchanged "blank"
		// field isn't mistaken for "clear my custom override".
		const currentAvatarUrl = user.avatarUrl === gravatarUrl(user.email) ? '' : user.avatarUrl;
		if (nextAvatarUrl !== currentAvatarUrl) {
			patch.avatarUrl = nextAvatarUrl;
		}
		if (Object.keys(patch).length === 0) {
			return;
		}
		setSaving(true);
		try {
			await updateProfile(patch);
			setSaved(true);
		} catch (caught) {
			setError(messageFor(caught, 'Could not save your changes.'));
		} finally {
			setSaving(false);
		}
	}

	async function onVerifyEmail() {
		if (verifying) {
			return;
		}
		setVerifyError(null);
		setResent(false);
		setVerifying(true);
		try {
			// On success the session adopts the new email and `pendingEmail` clears, so
			// this card unmounts.
			await verifyEmailChange({ code: code.trim() });
			setCode('');
		} catch (caught) {
			setVerifyError(messageFor(caught, 'Could not verify your new email.'));
		} finally {
			setVerifying(false);
		}
	}

	async function onResend() {
		if (!pendingEmail) {
			return;
		}
		setVerifyError(null);
		setResent(false);
		try {
			// Re-submitting the pending address re-issues the code to it.
			await updateProfile({ email: pendingEmail });
			setResent(true);
		} catch (caught) {
			setVerifyError(messageFor(caught, 'Could not resend the code.'));
		}
	}

	return (
		<ScrollView
			contentContainerStyle={styles.content}
			keyboardShouldPersistTaps="handled"
			showsVerticalScrollIndicator={false}
		>
			<Txt style={styles.h1}>Your profile</Txt>
			<Txt style={styles.subtitle}>Manage your personal details and sign-in email.</Txt>

			<Card style={styles.card}>
				<View style={styles.headerRow}>
					<SectionLabel>Personal information</SectionLabel>
					<Pill
						label={roleLabel(session.role)}
						color={colors.brandPurpleInk}
						background="rgba(110,30,200,0.08)"
					/>
				</View>
				<View style={styles.avatarRow}>
					<Avatar initials={initialsOf(user.name)} imageUrl={user.avatarUrl} size={56} />
					<Txt style={[styles.rowSub, styles.avatarHint]}>
						Defaults to your Gravatar — the photo linked to your email at gravatar.com. Set an
						"Image URL" below to use something else.
					</Txt>
				</View>
				<View style={styles.form}>
					<TextField
						label="Name"
						value={name}
						onChangeText={(next) => {
							setName(next);
							setSaved(false);
						}}
						placeholder="Marcus Thompson"
						autoCapitalize="words"
					/>
					<TextField
						label="Phone"
						value={phone}
						onChangeText={(next) => {
							setPhone(next);
							setSaved(false);
						}}
						placeholder="+1 (206) 555-0100"
						keyboardType="phone-pad"
					/>
					<TextField
						label="Email"
						value={email}
						onChangeText={(next) => {
							setEmail(next);
							setSaved(false);
						}}
						placeholder="you@business.com"
						autoCapitalize="none"
						autoComplete="email"
						keyboardType="email-address"
						hint="Changing your email sends a verification code to the new address — it stays the same until you confirm."
					/>
					<TextField
						label="Image URL"
						value={avatarUrl}
						onChangeText={(next) => {
							setAvatarUrl(next);
							setSaved(false);
						}}
						placeholder="https://example.com/photo.jpg"
						hint="Leave blank to use your Gravatar."
						autoCapitalize="none"
						autoCorrect={false}
						keyboardType="url"
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

			{pendingEmail ? (
				<Card style={[styles.card, styles.pendingCard]}>
					<SectionLabel style={styles.pendingLabel}>Verify your new email</SectionLabel>
					<Txt style={styles.rowSub}>
						We emailed a 6-digit code to {pendingEmail}. Enter it to switch your sign-in email from{' '}
						{liveEmail}. The code expires in 10 minutes.
					</Txt>
					<View style={styles.form}>
						<TextField
							label="Verification code"
							value={code}
							onChangeText={(next) => setCode(next.replace(/\D/g, '').slice(0, 6))}
							placeholder="123456"
							keyboardType="number-pad"
							autoComplete="one-time-code"
							textContentType="oneTimeCode"
							maxLength={6}
							style={styles.codeInput}
						/>

						{verifyError ? <Txt style={styles.errorTxt}>{verifyError}</Txt> : null}
						{resent ? <Txt style={styles.savedTxt}>A new code is on its way.</Txt> : null}

						<GradientButton
							label={verifying ? 'Verifying…' : 'Verify new email'}
							icon="check"
							onPress={onVerifyEmail}
						/>
						<OutlineButton label="Resend code" onPress={onResend} />
					</View>
				</Card>
			) : null}
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
	headerRow: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		// Let the label/role pill wrap instead of overflowing when the row is too
		// narrow (small screens, large text scaling); React Native defaults
		// flexShrink to 0, so set it explicitly. `gap` spaces them once wrapped.
		flexShrink: 1,
		flexWrap: 'wrap',
		gap: 8,
	},
	avatarRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 14,
	},
	avatarHint: {
		flex: 1,
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
	// A violet-tinted border marks the "action needed" verification card (the accent
	// colour, not the signature gradient), matching how Settings sets cards apart.
	pendingCard: {
		borderColor: 'rgba(110,30,200,0.30)',
	},
	pendingLabel: {
		color: colors.brandPurpleInk,
	},
	codeInput: {
		fontFamily: font.semibold,
		fontSize: 20,
		letterSpacing: 6,
	},
});

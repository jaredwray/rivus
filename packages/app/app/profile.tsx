import { gravatarUrl, type UpdateProfileInput } from '@rivus/core';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ApiError } from '@/src/api/client';
import { hasGravatar } from '@/src/api/gravatar';
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

/** The longest edge an uploaded photo is resized to before it's saved. */
const AVATAR_EDGE = 512;

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

	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [code, setCode] = useState('');
	const [verifying, setVerifying] = useState(false);
	const [verifyError, setVerifyError] = useState<string | null>(null);
	const [resent, setResent] = useState(false);

	// `null` while unknown, or while a custom avatar makes the question moot (see
	// the effect below) — only `false` (confirmed no Gravatar) offers the upload button.
	const [gravatarExists, setGravatarExists] = useState<boolean | null>(null);
	const [uploadingPhoto, setUploadingPhoto] = useState(false);
	const [avatarError, setAvatarError] = useState<string | null>(null);

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
	}, [user?.name, user?.phone, user?.email, user?.pendingEmail]);

	// `user.avatarUrl` is always a usable URL — a custom upload, or the Gravatar
	// `toPublicUser` computes from the email when there's none. An exact match
	// against that computed default (rather than just "looks like a Gravatar URL")
	// is what tells "no custom upload" apart from "a custom image that happens to be
	// hosted on gravatar.com". Only when there's no custom upload do we need to know
	// whether a *real* Gravatar exists, to decide whether to offer the upload button.
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on server values only, by design
	useEffect(() => {
		if (!user || user.avatarUrl !== gravatarUrl(user.email)) {
			setGravatarExists(null);
			return;
		}
		let active = true;
		hasGravatar(user.email).then((exists) => {
			if (active) {
				setGravatarExists(exists);
			}
		});
		return () => {
			active = false;
		};
	}, [user?.email, user?.avatarUrl]);

	if (!session || !user) {
		return null;
	}

	const pendingEmail = user.pendingEmail;
	const liveEmail = user.email;
	const hasCustomAvatar = user.avatarUrl !== gravatarUrl(user.email);

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
		if (nextName !== user.name) {
			patch.name = nextName;
		}
		if (nextPhone !== user.phone) {
			patch.phone = nextPhone;
		}
		if (nextEmail !== user.email) {
			patch.email = nextEmail;
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

	/**
	 * Pick a photo from the device, resize it to a small square, and save it as
	 * the profile's custom avatar (replacing the "no Gravatar" state immediately,
	 * rather than waiting for the "Save changes" button below).
	 */
	async function pickAndUploadPhoto() {
		if (uploadingPhoto) {
			return;
		}
		setAvatarError(null);
		try {
			const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
			if (!permission.granted) {
				setAvatarError('Allow photo access to upload a picture.');
				return;
			}
			const picked = await ImagePicker.launchImageLibraryAsync({
				mediaTypes: ['images'],
				allowsEditing: true,
				aspect: [1, 1],
				quality: 0.8,
			});
			if (picked.canceled) {
				return;
			}
			const asset = picked.assets[0];
			if (!asset) {
				return;
			}
			setUploadingPhoto(true);
			// Bound whichever dimension is larger so a non-square pick (the web picker
			// has no crop step) can't leave the other dimension unbounded.
			const resizeTo =
				asset.width >= asset.height ? { width: AVATAR_EDGE } : { height: AVATAR_EDGE };
			const rendered = await ImageManipulator.manipulate(asset.uri).resize(resizeTo).renderAsync();
			const saved = await rendered.saveAsync({
				compress: 0.7,
				format: SaveFormat.JPEG,
				base64: true,
			});
			if (!saved.base64) {
				throw new Error('Could not process that photo.');
			}
			await updateProfile({ avatarUrl: `data:image/jpeg;base64,${saved.base64}` });
		} catch (caught) {
			setAvatarError(messageFor(caught, 'Could not upload that photo.'));
		} finally {
			setUploadingPhoto(false);
		}
	}

	/** Clear the custom avatar, reverting to the Gravatar (or initials) fallback. */
	async function removePhoto() {
		if (uploadingPhoto) {
			return;
		}
		setAvatarError(null);
		setUploadingPhoto(true);
		try {
			await updateProfile({ avatarUrl: '' });
		} catch (caught) {
			setAvatarError(messageFor(caught, 'Could not remove your photo.'));
		} finally {
			setUploadingPhoto(false);
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
				<View style={styles.avatarSection}>
					<View style={styles.avatarRow}>
						<Avatar initials={initialsOf(user.name)} imageUrl={user.avatarUrl} size={56} />
						<Txt style={[styles.rowSub, styles.avatarHint]}>
							{hasCustomAvatar
								? 'Your uploaded photo. Remove it to use your Gravatar (or initials) instead.'
								: gravatarExists === false
									? 'No Gravatar found for this email — upload a photo, or set one up at gravatar.com.'
									: 'Defaults to your Gravatar — the photo linked to your email at gravatar.com.'}
						</Txt>
					</View>
					{hasCustomAvatar || gravatarExists === false ? (
						<View style={styles.avatarActions}>
							<OutlineButton
								label={
									uploadingPhoto ? 'Uploading…' : hasCustomAvatar ? 'Change photo' : 'Upload photo'
								}
								onPress={pickAndUploadPhoto}
							/>
							{hasCustomAvatar ? (
								<OutlineButton label="Remove photo" onPress={removePhoto} />
							) : null}
						</View>
					) : null}
					{avatarError ? <Txt style={styles.errorTxt}>{avatarError}</Txt> : null}
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
	avatarSection: {
		gap: 10,
	},
	avatarRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 14,
	},
	avatarHint: {
		flex: 1,
	},
	avatarActions: {
		flexDirection: 'row',
		gap: 8,
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

import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import type { Invite } from '@/src/api/client';
import { buildInviteAcceptUrl } from '@/src/api/config';
import { roleLabel } from '@/src/auth/AuthContext';
import { colors, font, radii, shadowSoft } from '@/src/theme/tokens';
import { BrandGradient } from './Gradient';
import { GradientButton, Pill, Txt } from './ui';

/**
 * Copy a value to the system clipboard. Backed by `expo-clipboard` so it works
 * on web and native alike. Resolves `true` when the write succeeds — native
 * always resolves `true`; web reflects the real outcome (it can be denied in an
 * insecure context or without permission), in which case callers leave the
 * value as selectable text to copy by hand.
 */
async function copyToClipboard(value: string): Promise<boolean> {
	try {
		return await Clipboard.setStringAsync(value);
	} catch {
		return false;
	}
}

/** A read-only value shown in a field with a one-tap copy button. */
function CopyField({ label, value }: { label: string; value: string }) {
	const [copied, setCopied] = useState(false);
	const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(
		() => () => {
			if (resetTimer.current) {
				clearTimeout(resetTimer.current);
			}
		},
		[],
	);

	async function onCopy() {
		const ok = await copyToClipboard(value);
		if (!ok) {
			return;
		}
		setCopied(true);
		if (resetTimer.current) {
			clearTimeout(resetTimer.current);
		}
		resetTimer.current = setTimeout(() => setCopied(false), 1800);
	}

	return (
		<View style={styles.fieldWrap}>
			<Txt style={styles.fieldLabel}>{label}</Txt>
			<View style={styles.copyRow}>
				<Txt selectable numberOfLines={1} style={styles.copyValue}>
					{value}
				</Txt>
				<Pressable
					onPress={onCopy}
					accessibilityRole="button"
					accessibilityLabel={`Copy ${label.toLowerCase()}`}
					style={({ pressed }) => [
						styles.copyBtn,
						copied && styles.copyBtnDone,
						pressed && styles.pressed,
					]}
				>
					<Feather
						name={copied ? 'check' : 'copy'}
						size={13}
						color={copied ? colors.green : colors.brandPurple}
					/>
					<Txt style={[styles.copyBtnTxt, copied && styles.copyBtnTxtDone]}>
						{copied ? 'Copied' : 'Copy'}
					</Txt>
				</Pressable>
			</View>
		</View>
	);
}

/**
 * Success dialog shown after an invite is created. Surfaces the full
 * accept-invitation link (with the code embedded in the URL) plus the bare code,
 * each copyable, so the inviter can share whichever is convenient.
 */
export function InviteCreatedModal({
	invite,
	accountName,
	onClose,
}: {
	invite: Invite | null;
	accountName: string;
	onClose: () => void;
}) {
	// `invite` flips to null the instant the dialog is dismissed. Drive the
	// Modal's `visible` off that live value, but render from the last non-null
	// invite so the sheet stays put and fades out with the backdrop instead of
	// vanishing the moment it's closed.
	const [lastShown, setLastShown] = useState<Invite | null>(null);
	useEffect(() => {
		if (invite) {
			setLastShown(invite);
		}
	}, [invite]);

	const shown = invite ?? lastShown;
	const acceptUrl = shown ? buildInviteAcceptUrl(shown.token) : '';

	return (
		<Modal visible={invite !== null} transparent animationType="fade" onRequestClose={onClose}>
			<Pressable style={styles.backdrop} onPress={onClose}>
				{shown ? (
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
							<Feather name="user-check" size={24} color="#fff" />
						</BrandGradient>

						<Txt style={styles.title}>Invitation ready</Txt>
						<Txt style={styles.subtitle}>
							Share this link with <Txt style={styles.subtitleStrong}>{shown.email}</Txt> so they
							can join {accountName}.
						</Txt>

						<Pill
							label={`Joining as ${roleLabel(shown.role)}`}
							color={colors.brandPurpleInk}
							background={colors.purpleTint}
							style={styles.rolePill}
						/>

						<CopyField label="Invite link" value={acceptUrl} />
						<CopyField label="Invite code" value={shown.token} />

						<GradientButton label="Done" onPress={onClose} style={styles.done} />
					</Pressable>
				) : null}
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
	},
	badge: {
		width: 52,
		height: 52,
		borderRadius: radii.xl,
		alignItems: 'center',
		justifyContent: 'center',
	},
	title: {
		fontFamily: font.bold,
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
	subtitleStrong: {
		fontFamily: font.semibold,
		color: colors.textSub,
	},
	rolePill: {
		marginTop: 2,
		marginBottom: 4,
	},
	fieldWrap: {
		gap: 6,
	},
	fieldLabel: {
		fontFamily: font.semibold,
		fontSize: 12,
		letterSpacing: 0.3,
		color: colors.textSub,
	},
	copyRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		backgroundColor: colors.field,
		borderWidth: 1,
		borderColor: colors.borderField,
		borderRadius: radii.md,
		paddingVertical: 9,
		paddingLeft: 12,
		paddingRight: 8,
	},
	copyValue: {
		flex: 1,
		minWidth: 0,
		fontFamily: font.medium,
		fontSize: 13,
		color: colors.brandPurpleInk,
	},
	copyBtn: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 5,
		paddingVertical: 6,
		paddingHorizontal: 10,
		borderRadius: radii.sm,
		backgroundColor: colors.surface,
		borderWidth: 1,
		borderColor: colors.border,
	},
	copyBtnDone: {
		borderColor: 'rgba(31,181,115,0.4)',
	},
	copyBtnTxt: {
		fontFamily: font.semibold,
		fontSize: 12,
		color: colors.brandPurple,
	},
	copyBtnTxtDone: {
		color: colors.green,
	},
	pressed: {
		opacity: 0.7,
	},
	done: {
		marginTop: 4,
	},
});

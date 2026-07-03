import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet } from 'react-native';
import type { Invite } from '@/src/api/client';
import { buildInviteAcceptUrl } from '@/src/api/config';
import { roleLabel } from '@/src/auth/AuthContext';
import { colors, font, radii, shadowSoft } from '@/src/theme/tokens';
import { CopyField } from './CopyField';
import { BrandGradient } from './Gradient';
import { GradientButton, Pill, Txt } from './ui';

/**
 * Success dialog shown after an invite is created. Confirms the invitation
 * email was sent and offers the full accept-invitation link (with the code
 * embedded in the URL), copyable, as a fallback the inviter can share directly.
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

						<Txt style={styles.title}>Invitation sent</Txt>
						<Txt style={styles.subtitle}>
							We emailed <Txt style={styles.subtitleStrong}>{shown.email}</Txt> a link to join{' '}
							{accountName}. If it doesn’t arrive, you can share this link with them:
						</Txt>

						<Pill
							label={`Joining as ${roleLabel(shown.role)}`}
							color={colors.brandPurpleInk}
							background={colors.purpleTint}
							style={styles.rolePill}
						/>

						<CopyField label="Invite link" value={acceptUrl} />

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
	done: {
		marginTop: 4,
	},
});

import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import type { Faq } from '@/src/api/client';
import { colors, font, radii, shadowSoft } from '@/src/theme/tokens';
import { BrandGradient } from './Gradient';
import { GradientButton, OutlineButton, Pill, Txt } from './ui';

/**
 * Shown after the AI duplicate check finds an existing FAQ close to the one the
 * user is adding. Recommends updating that FAQ with the combined text (the
 * primary action) and offers adding it as a brand-new FAQ instead.
 */
export function FaqDuplicateModal({
	match,
	reason,
	onUpdateExisting,
	onCreateAnyway,
	onClose,
}: {
	match: Faq | null;
	reason: string;
	onUpdateExisting: () => void;
	onCreateAnyway: () => void;
	onClose: () => void;
}) {
	// `match` flips to null the instant the dialog is dismissed. Drive the Modal's
	// `visible` off that live value, but render from the last non-null match so the
	// sheet fades out with the backdrop instead of vanishing the moment it closes.
	const [lastShown, setLastShown] = useState<Faq | null>(null);
	useEffect(() => {
		if (match) {
			setLastShown(match);
		}
	}, [match]);

	const shown = match ?? lastShown;

	return (
		<Modal visible={match !== null} transparent animationType="fade" onRequestClose={onClose}>
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
							<Feather name="copy" size={22} color="#fff" />
						</BrandGradient>

						<Txt style={styles.title}>This looks like an existing FAQ</Txt>
						<Txt style={styles.subtitle}>
							{reason
								? reason
								: 'You already have a similar FAQ. Update it with your new wording instead of adding a duplicate?'}
						</Txt>

						<View style={styles.card}>
							{shown.category ? (
								<Pill
									label={shown.category}
									color={colors.brandPurpleInk}
									background={colors.purpleTint}
									style={styles.cardPill}
								/>
							) : null}
							<Txt style={styles.cardQuestion} numberOfLines={2}>
								{shown.question}
							</Txt>
							<Txt style={styles.cardAnswer} numberOfLines={3}>
								{shown.answer}
							</Txt>
						</View>

						<GradientButton
							label="Update existing FAQ"
							icon="edit-3"
							onPress={onUpdateExisting}
							style={styles.primary}
						/>
						<OutlineButton label="Add as new FAQ" onPress={onCreateAnyway} />
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
	card: {
		backgroundColor: colors.field,
		borderWidth: 1,
		borderColor: colors.borderField,
		borderRadius: radii.md,
		padding: 14,
		gap: 6,
	},
	cardPill: {
		alignSelf: 'flex-start',
		marginBottom: 2,
	},
	cardQuestion: {
		fontFamily: font.semibold,
		fontSize: 14,
		color: colors.text,
	},
	cardAnswer: {
		fontFamily: font.regular,
		fontSize: 12.5,
		lineHeight: 18,
		color: colors.textSub,
	},
	primary: {
		marginTop: 4,
	},
});

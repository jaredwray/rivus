import { Feather } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import {
	Pressable,
	type StyleProp,
	StyleSheet,
	Text,
	type TextProps,
	type TextStyle,
	View,
	type ViewStyle,
} from 'react-native';
import { RivusSymbol } from '../brand/RivusLogo';
import { colors, font, radii, shadowCard } from '../theme/tokens';
import { BrandGradient } from './Gradient';

type FeatherName = ComponentProps<typeof Feather>['name'];

/** Text with Montserrat applied by default. Override weight/size/color via style. */
export function Txt({ style, ...rest }: TextProps) {
	return <Text {...rest} style={[styles.txt, style]} />;
}

/** A line-icon (Feather) with a sensible default color. */
export function Icon({
	name,
	size = 18,
	color = colors.textSub,
}: {
	name: FeatherName;
	size?: number;
	color?: string;
}) {
	return <Feather name={name} size={size} color={color} />;
}

/** White rounded surface card with the standard border + subtle shadow. */
export function Card({
	children,
	style,
	padded = true,
}: {
	children?: ReactNode;
	style?: StyleProp<ViewStyle>;
	padded?: boolean;
}) {
	return <View style={[styles.card, padded && styles.cardPad, style]}>{children}</View>;
}

/** Pill-shaped status label, e.g. "Confirmed" / "Balance due". */
export function Pill({
	label,
	color = colors.textSub,
	background = colors.chipBg,
	style,
}: {
	label: string;
	color?: string;
	background?: string;
	style?: StyleProp<ViewStyle>;
}) {
	return (
		<View style={[styles.pill, { backgroundColor: background }, style]}>
			<Txt style={[styles.pillTxt, { color }]}>{label}</Txt>
		</View>
	);
}

/** Circular initials avatar. */
export function Avatar({
	initials,
	size = 40,
	background = colors.avatarBg,
	color = colors.avatarText,
}: {
	initials: string;
	size?: number;
	background?: string;
	color?: string;
}) {
	return (
		<View
			style={[
				styles.avatar,
				{ width: size, height: size, borderRadius: size / 2, backgroundColor: background },
			]}
		>
			<Txt style={[styles.avatarTxt, { color, fontSize: Math.round(size * 0.32) }]}>{initials}</Txt>
		</View>
	);
}

/** Small colored status dot. */
export function Dot({ color, size = 9 }: { color: string; size?: number }) {
	return (
		<View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
	);
}

/** Uppercase, letter-spaced section label. */
export function SectionLabel({
	children,
	style,
}: {
	children: ReactNode;
	style?: StyleProp<TextStyle>;
}) {
	return <Txt style={[styles.sectionLabel, style]}>{children}</Txt>;
}

/** Rounded gradient square containing a white check (used as a "done by Rivus" mark). */
export function GradientMark({
	size = 16,
	radius = 5,
	icon = 'check',
	iconSize,
}: {
	size?: number;
	radius?: number;
	icon?: FeatherName;
	iconSize?: number;
}) {
	return (
		<BrandGradient style={[styles.center, { width: size, height: size, borderRadius: radius }]}>
			<Feather name={icon} size={iconSize ?? Math.round(size * 0.62)} color="#fff" />
		</BrandGradient>
	);
}

/** Gradient square holding the Rivus symbol (the agent avatar). */
export function RivusBadge({ size = 40, radius = 12 }: { size?: number; radius?: number }) {
	return (
		<BrandGradient style={[styles.center, { width: size, height: size, borderRadius: radius }]}>
			<RivusSymbol size={Math.round(size * 0.6)} />
		</BrandGradient>
	);
}

/** Primary action button with the brand gradient. */
export function GradientButton({
	label,
	icon,
	onPress,
	style,
}: {
	label: string;
	icon?: FeatherName;
	onPress?: () => void;
	style?: StyleProp<ViewStyle>;
}) {
	return (
		<Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.pressed, style]}>
			<BrandGradient style={styles.gradientBtn}>
				{icon ? <Feather name={icon} size={16} color="#fff" /> : null}
				<Txt style={styles.gradientBtnTxt}>{label}</Txt>
			</BrandGradient>
		</Pressable>
	);
}

/** The cyan/purple-tinted "Rivus is online" status chip with a live green dot. */
export function RivusStatusChip({ label }: { label: string }) {
	return (
		<View style={styles.statusChip}>
			<Dot color={colors.green} size={7} />
			<Txt style={styles.statusChipTxt}>{label}</Txt>
		</View>
	);
}

export const styles = StyleSheet.create({
	txt: {
		fontFamily: font.regular,
		color: colors.text,
		fontSize: 14,
	},
	card: {
		backgroundColor: colors.surface,
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: radii.xxl,
		...shadowCard,
	},
	cardPad: {
		padding: 20,
	},
	pill: {
		alignSelf: 'flex-start',
		paddingVertical: 3,
		paddingHorizontal: 10,
		borderRadius: radii.pill,
	},
	pillTxt: {
		fontFamily: font.semibold,
		fontSize: 11,
	},
	avatar: {
		alignItems: 'center',
		justifyContent: 'center',
	},
	avatarTxt: {
		fontFamily: font.semibold,
	},
	sectionLabel: {
		fontFamily: font.semibold,
		fontSize: 12,
		letterSpacing: 0.7,
		textTransform: 'uppercase',
		color: colors.textFaint,
	},
	center: {
		alignItems: 'center',
		justifyContent: 'center',
	},
	gradientBtn: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		paddingVertical: 11,
		paddingHorizontal: 16,
		borderRadius: radii.lg,
	},
	gradientBtnTxt: {
		fontFamily: font.semibold,
		fontSize: 13.5,
		color: '#fff',
	},
	pressed: {
		opacity: 0.85,
	},
	statusChip: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		paddingVertical: 6,
		paddingHorizontal: 12,
		borderRadius: radii.pill,
		borderWidth: 1,
		borderColor: 'rgba(110,30,200,0.16)',
		backgroundColor: 'rgba(110,30,200,0.06)',
	},
	statusChipTxt: {
		fontFamily: font.semibold,
		fontSize: 12,
		color: colors.brandPurpleInk,
	},
});

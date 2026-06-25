import { Feather } from '@expo/vector-icons';
import { type ComponentProps, type ReactNode, useMemo, useState } from 'react';
import {
	FlatList,
	Modal,
	Pressable,
	type StyleProp,
	StyleSheet,
	Text,
	TextInput,
	type TextInputProps,
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

/** A labelled text input. Spreads through any `TextInput` prop. */
export function TextField({
	label,
	hint,
	style,
	...rest
}: { label: string; hint?: string } & TextInputProps) {
	return (
		<View style={styles.fieldWrap}>
			<Txt style={styles.fieldLabel}>{label}</Txt>
			<TextInput placeholderTextColor={colors.textHint} {...rest} style={[styles.input, style]} />
			{hint ? <Txt style={styles.fieldHint}>{hint}</Txt> : null}
		</View>
	);
}

export interface SelectOption {
	label: string;
	value: string;
}

/**
 * A labelled dropdown: a field-styled trigger that opens a modal list. Optional
 * search filters long lists (e.g. the IANA timezones). Cross-platform — uses RN
 * primitives so it works on web and native.
 */
export function Select({
	label,
	value,
	options,
	onSelect,
	placeholder = 'Select…',
	searchable = false,
	hint,
}: {
	label: string;
	value: string;
	options: SelectOption[];
	onSelect: (value: string) => void;
	placeholder?: string;
	searchable?: boolean;
	hint?: string;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');

	const selected = options.find((option) => option.value === value);
	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) {
			return options;
		}
		return options.filter((option) => option.label.toLowerCase().includes(needle));
	}, [options, query]);

	function choose(next: string) {
		onSelect(next);
		setOpen(false);
		setQuery('');
	}

	return (
		<View style={styles.fieldWrap}>
			<Txt style={styles.fieldLabel}>{label}</Txt>
			<Pressable
				onPress={() => setOpen(true)}
				style={[styles.input, styles.selectTrigger]}
				accessibilityRole="button"
			>
				<Txt style={selected ? styles.selectValue : styles.selectPlaceholder}>
					{selected ? selected.label : placeholder}
				</Txt>
				<Feather name="chevron-down" size={16} color={colors.textMuted} />
			</Pressable>
			{hint ? <Txt style={styles.fieldHint}>{hint}</Txt> : null}

			<Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
				<Pressable style={styles.selectBackdrop} onPress={() => setOpen(false)}>
					<Pressable style={styles.selectSheet} onPress={() => {}}>
						<View style={styles.selectSheetHeader}>
							<Txt style={styles.selectSheetTitle}>{label}</Txt>
							<Pressable onPress={() => setOpen(false)} accessibilityRole="button">
								<Feather name="x" size={18} color={colors.textMuted} />
							</Pressable>
						</View>
						{searchable ? (
							<TextInput
								placeholder="Search…"
								placeholderTextColor={colors.textHint}
								value={query}
								onChangeText={setQuery}
								autoCorrect={false}
								autoCapitalize="none"
								style={[styles.input, styles.selectSearch]}
							/>
						) : null}
						<FlatList
							data={filtered}
							keyExtractor={(option) => option.value}
							keyboardShouldPersistTaps="handled"
							style={styles.selectList}
							renderItem={({ item }) => {
								const active = item.value === value;
								return (
									<Pressable
										onPress={() => choose(item.value)}
										style={[styles.selectRow, active && styles.selectRowActive]}
									>
										<Txt style={[styles.selectRowTxt, active && styles.selectRowTxtActive]}>
											{item.label}
										</Txt>
										{active ? <Feather name="check" size={16} color={colors.brandPurple} /> : null}
									</Pressable>
								);
							}}
						/>
					</Pressable>
				</Pressable>
			</Modal>
		</View>
	);
}

/** A segmented single-choice control (e.g. picking a role). */
export function Segmented<T extends string>({
	options,
	value,
	onChange,
}: {
	options: { label: string; value: T }[];
	value: T;
	onChange: (value: T) => void;
}) {
	return (
		<View style={styles.segmented}>
			{options.map((option) => {
				const active = option.value === value;
				return (
					<Pressable
						key={option.value}
						onPress={() => onChange(option.value)}
						style={[styles.segment, active && styles.segmentActive]}
					>
						<Txt style={[styles.segmentTxt, active && styles.segmentTxtActive]}>{option.label}</Txt>
					</Pressable>
				);
			})}
		</View>
	);
}

/** Secondary (outline) button for low-emphasis actions. */
export function OutlineButton({
	label,
	onPress,
	style,
}: {
	label: string;
	onPress?: () => void;
	style?: StyleProp<ViewStyle>;
}) {
	return (
		<Pressable
			onPress={onPress}
			style={({ pressed }) => [styles.outlineBtn, pressed && styles.pressed, style]}
		>
			<Txt style={styles.outlineBtnTxt}>{label}</Txt>
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
	fieldWrap: {
		gap: 6,
	},
	fieldLabel: {
		fontFamily: font.semibold,
		fontSize: 12.5,
		color: colors.textSub,
	},
	fieldHint: {
		fontSize: 11.5,
		color: colors.textFaint,
	},
	input: {
		fontFamily: font.regular,
		fontSize: 14,
		color: colors.text,
		backgroundColor: colors.field,
		borderWidth: 1,
		borderColor: colors.borderField,
		borderRadius: radii.md,
		paddingVertical: 11,
		paddingHorizontal: 13,
	},
	selectTrigger: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
	},
	selectValue: {
		fontSize: 14,
		color: colors.text,
	},
	selectPlaceholder: {
		fontSize: 14,
		color: colors.textHint,
	},
	selectBackdrop: {
		flex: 1,
		backgroundColor: 'rgba(15,15,25,0.45)',
		justifyContent: 'center',
		alignItems: 'center',
		padding: 20,
	},
	selectSheet: {
		width: '100%',
		maxWidth: 420,
		maxHeight: '70%',
		backgroundColor: colors.surface,
		borderRadius: radii.lg,
		padding: 14,
		gap: 10,
	},
	selectSheetHeader: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
	},
	selectSheetTitle: {
		fontFamily: font.semibold,
		fontSize: 14,
		color: colors.text,
	},
	selectSearch: {
		marginBottom: 2,
	},
	selectList: {
		flexGrow: 0,
	},
	selectRow: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingVertical: 11,
		paddingHorizontal: 12,
		borderRadius: radii.sm,
	},
	selectRowActive: {
		backgroundColor: colors.field,
	},
	selectRowTxt: {
		fontFamily: font.regular,
		fontSize: 13.5,
		color: colors.textSub,
	},
	selectRowTxtActive: {
		fontFamily: font.semibold,
		color: colors.text,
	},
	segmented: {
		flexDirection: 'row',
		gap: 6,
		backgroundColor: colors.field,
		borderRadius: radii.md,
		padding: 4,
	},
	segment: {
		flex: 1,
		alignItems: 'center',
		paddingVertical: 9,
		borderRadius: radii.sm,
	},
	segmentActive: {
		backgroundColor: colors.surface,
		...shadowCard,
	},
	segmentTxt: {
		fontFamily: font.medium,
		fontSize: 12.5,
		color: colors.textMuted,
	},
	segmentTxtActive: {
		color: colors.text,
		fontFamily: font.semibold,
	},
	outlineBtn: {
		alignItems: 'center',
		justifyContent: 'center',
		paddingVertical: 11,
		paddingHorizontal: 16,
		borderRadius: radii.lg,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.surface,
	},
	outlineBtnTxt: {
		fontFamily: font.semibold,
		fontSize: 13.5,
		color: colors.textSub,
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

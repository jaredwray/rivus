import { Feather } from '@expo/vector-icons';
import { type ComponentProps, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
	ActivityIndicator,
	Animated,
	FlatList,
	Image,
	Modal,
	Pressable,
	type PressableStateCallbackType,
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
import { colors, font, radii, shadowCard, shadowSoft } from '../theme/tokens';
import { BrandGradient } from './Gradient';

type FeatherName = ComponentProps<typeof Feather>['name'];

// react-native-web extends Pressable's style-callback state with `hovered` /
// `focused`; core react-native types only declare `pressed`. Widening the state
// here keeps hover affordances typed without `any` — on native the extra flags
// are simply undefined and the hover styles never apply.
type PressableState = PressableStateCallbackType & { hovered?: boolean; focused?: boolean };

/** Shared props for the button family. */
type ButtonProps = {
	label: string;
	icon?: FeatherName;
	onPress?: () => void;
	style?: StyleProp<ViewStyle>;
	/** Grays the button out and ignores presses. */
	disabled?: boolean;
	/** Swaps the icon slot for a spinner and ignores presses while work is in flight. */
	loading?: boolean;
};

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

/**
 * Circular avatar. Shows `imageUrl` (e.g. a Gravatar or a custom upload) when
 * given; falls back to 2-letter initials when there's no image, or the image
 * fails to load (an unset Gravatar 404s, by design — see `gravatarUrl`).
 */
export function Avatar({
	initials,
	imageUrl,
	size = 40,
	background = colors.avatarBg,
	color = colors.avatarText,
}: {
	initials: string;
	imageUrl?: string;
	size?: number;
	background?: string;
	color?: string;
}) {
	// Reset the "failed to load" flag whenever `imageUrl` itself changes (e.g. the
	// user saves a new avatar after an old one 404'd) — without this, `imageFailed`
	// would stick from the previous URL and the new image would never be tried.
	const [[trackedUrl, imageFailed], setImageState] = useState<[string | undefined, boolean]>([
		imageUrl,
		false,
	]);
	if (trackedUrl !== imageUrl) {
		setImageState([imageUrl, false]);
	}
	const showImage = Boolean(imageUrl) && !imageFailed;

	return (
		<View
			style={[
				styles.avatar,
				{ width: size, height: size, borderRadius: size / 2, backgroundColor: background },
			]}
		>
			{showImage ? (
				<Image
					source={{ uri: imageUrl }}
					style={{ width: size, height: size, borderRadius: size / 2 }}
					onError={() => setImageState([imageUrl, true])}
					accessibilityIgnoresInvertColors
				/>
			) : (
				<Txt style={[styles.avatarTxt, { color, fontSize: Math.round(size * 0.32) }]}>
					{initials}
				</Txt>
			)}
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
export function GradientButton({ label, icon, onPress, style, disabled, loading }: ButtonProps) {
	const inert = Boolean(disabled || loading);
	return (
		<Pressable
			onPress={onPress}
			disabled={inert}
			accessibilityRole="button"
			accessibilityState={{ disabled: inert, busy: Boolean(loading) }}
			aria-busy={Boolean(loading)}
			aria-disabled={inert}
			style={(state) => {
				const { pressed, hovered } = state as PressableState;
				return [
					styles.gradientBtnWrap,
					hovered && !inert && styles.btnHoverLift,
					pressed && !inert && styles.pressed,
					disabled && styles.btnDisabled,
					style,
				];
			}}
		>
			<BrandGradient style={styles.gradientBtn}>
				{loading ? (
					<ActivityIndicator size="small" color="#fff" style={styles.btnSpinner} />
				) : icon ? (
					<Feather name={icon} size={16} color="#fff" />
				) : null}
				<Txt style={styles.gradientBtnTxt}>{label}</Txt>
			</BrandGradient>
		</Pressable>
	);
}

/**
 * Destructive action button — solid Danger red. Destructive confirms never wear
 * the brand gradient (that marks Rivus-the-agent; see DESIGN_SYSTEM.md).
 */
export function DangerButton({ label, icon, onPress, style, disabled, loading }: ButtonProps) {
	const inert = Boolean(disabled || loading);
	return (
		<Pressable
			onPress={onPress}
			disabled={inert}
			accessibilityRole="button"
			accessibilityState={{ disabled: inert, busy: Boolean(loading) }}
			aria-busy={Boolean(loading)}
			aria-disabled={inert}
			style={(state) => {
				const { pressed, hovered } = state as PressableState;
				return [
					styles.dangerBtn,
					hovered && !inert && styles.dangerBtnHover,
					pressed && !inert && styles.pressed,
					disabled && styles.btnDisabled,
					style,
				];
			}}
		>
			{loading ? (
				<ActivityIndicator size="small" color="#fff" style={styles.btnSpinner} />
			) : icon ? (
				<Feather name={icon} size={16} color="#fff" />
			) : null}
			<Txt style={styles.gradientBtnTxt}>{label}</Txt>
		</Pressable>
	);
}

// Thumb geometry for Switch: a 46×26 pill track with a 2px inset, so the 22px
// thumb travels the remaining 20px when toggled on.
const SWITCH_THUMB_TRAVEL = 20;

/**
 * Animated on/off switch for boolean settings. The on state wears the brand
 * gradient: flipping a switch puts Rivus-the-agent live on something, which is
 * AI status (see DESIGN_SYSTEM.md). While `busy` the thumb holds a spinner and
 * presses are ignored, so an in-flight change can't be double-toggled.
 */
export function Switch({
	value,
	onValueChange,
	disabled,
	busy,
	accessibilityLabel,
}: {
	value: boolean;
	onValueChange?: (value: boolean) => void;
	disabled?: boolean;
	/** Shows a spinner in the thumb and ignores presses while a change is in flight. */
	busy?: boolean;
	accessibilityLabel?: string;
}) {
	const position = useRef(new Animated.Value(value ? 1 : 0)).current;

	useEffect(() => {
		Animated.timing(position, {
			toValue: value ? 1 : 0,
			duration: 160,
			// Animated values also drive the track crossfade; the JS driver keeps
			// behavior identical on web (react-native-web) and native.
			useNativeDriver: false,
		}).start();
	}, [position, value]);

	const inert = Boolean(disabled || busy);

	return (
		<Pressable
			onPress={() => onValueChange?.(!value)}
			disabled={inert || !onValueChange}
			accessibilityRole="switch"
			accessibilityLabel={accessibilityLabel}
			accessibilityState={{ checked: value, disabled: inert, busy: Boolean(busy) }}
			// react-native-web doesn't derive aria-* from accessibilityState, so
			// mirror the state explicitly for web screen readers.
			aria-checked={value}
			aria-busy={Boolean(busy)}
			aria-disabled={inert}
			hitSlop={8}
			style={({ pressed }) => [
				styles.switchTrack,
				pressed && !inert && styles.switchPressed,
				disabled && styles.btnDisabled,
			]}
		>
			<Animated.View style={[styles.switchTrackOn, { opacity: position }]}>
				<BrandGradient style={styles.switchTrackFill} />
			</Animated.View>
			<Animated.View
				style={[
					styles.switchThumb,
					{
						transform: [
							{
								translateX: position.interpolate({
									inputRange: [0, 1],
									outputRange: [0, SWITCH_THUMB_TRAVEL],
								}),
							},
						],
					},
				]}
			>
				{busy ? (
					<ActivityIndicator size="small" color={colors.brandPurple} style={styles.switchSpinner} />
				) : null}
			</Animated.View>
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
		<View style={styles.segmented} accessibilityRole="radiogroup">
			{options.map((option) => {
				const active = option.value === value;
				return (
					<Pressable
						key={option.value}
						onPress={() => onChange(option.value)}
						accessibilityRole="radio"
						accessibilityState={{ checked: active }}
						aria-checked={active}
						style={(state) => {
							const { hovered } = state as PressableState;
							return [
								styles.segment,
								hovered && !active && styles.segmentHover,
								active && styles.segmentActive,
							];
						}}
					>
						<Txt style={[styles.segmentTxt, active && styles.segmentTxtActive]}>{option.label}</Txt>
					</Pressable>
				);
			})}
		</View>
	);
}

/**
 * Secondary (outline) button for low-emphasis actions. The `danger` tone marks
 * the entry point to a destructive flow (red text, red-tinted hairline) — the
 * confirm itself is a {@link DangerButton}.
 */
export function OutlineButton({
	label,
	icon,
	onPress,
	style,
	disabled,
	loading,
	tone = 'default',
}: ButtonProps & { tone?: 'default' | 'danger' }) {
	const inert = Boolean(disabled || loading);
	const danger = tone === 'danger';
	const contentColor = danger ? colors.redInk : colors.textSub;
	return (
		<Pressable
			onPress={onPress}
			disabled={inert}
			accessibilityRole="button"
			accessibilityState={{ disabled: inert, busy: Boolean(loading) }}
			aria-busy={Boolean(loading)}
			aria-disabled={inert}
			style={(state) => {
				const { pressed, hovered } = state as PressableState;
				return [
					styles.outlineBtn,
					danger && styles.outlineBtnDanger,
					hovered && !inert && (danger ? styles.outlineBtnDangerHover : styles.outlineBtnHover),
					pressed && !inert && styles.pressed,
					disabled && styles.btnDisabled,
					style,
				];
			}}
		>
			{loading ? (
				<ActivityIndicator size="small" color={contentColor} style={styles.btnSpinner} />
			) : icon ? (
				<Feather name={icon} size={16} color={contentColor} />
			) : null}
			<Txt style={[styles.outlineBtnTxt, danger && styles.outlineBtnTxtDanger]}>{label}</Txt>
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
		overflow: 'hidden',
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
	// The focusable wrapper carries the same radius as the gradient so the
	// keyboard focus ring hugs the button's rounded corners.
	gradientBtnWrap: {
		borderRadius: radii.lg,
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
	btnHoverLift: {
		opacity: 0.92,
		...shadowSoft,
	},
	btnDisabled: {
		opacity: 0.5,
	},
	// Constrain the spinner to the 16px icon slot so a button keeps its height
	// when `loading` swaps the icon out (the "small" indicator draws at 20px).
	btnSpinner: {
		width: 16,
		height: 16,
		transform: [{ scale: 0.75 }],
	},
	dangerBtn: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		gap: 8,
		paddingVertical: 11,
		paddingHorizontal: 16,
		borderRadius: radii.lg,
		backgroundColor: colors.red,
	},
	dangerBtnHover: {
		backgroundColor: colors.redInk,
	},
	switchTrack: {
		width: 46,
		height: 26,
		borderRadius: radii.pill,
		padding: 2,
		backgroundColor: colors.switchTrackOff,
		justifyContent: 'center',
		cursor: 'pointer',
	},
	switchTrackOn: {
		position: 'absolute',
		top: 0,
		left: 0,
		right: 0,
		bottom: 0,
		borderRadius: radii.pill,
		overflow: 'hidden',
	},
	switchTrackFill: {
		flex: 1,
	},
	switchThumb: {
		width: 22,
		height: 22,
		borderRadius: radii.pill,
		backgroundColor: colors.surface,
		alignItems: 'center',
		justifyContent: 'center',
		...shadowSoft,
	},
	switchSpinner: {
		transform: [{ scale: 0.7 }],
	},
	switchPressed: {
		opacity: 0.9,
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
		borderWidth: 1,
		borderColor: colors.borderField,
		borderRadius: radii.md,
		padding: 4,
	},
	segment: {
		flex: 1,
		alignItems: 'center',
		paddingVertical: 9,
		borderRadius: radii.sm,
	},
	segmentHover: {
		backgroundColor: 'rgba(22,22,31,0.05)',
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
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		gap: 8,
		paddingVertical: 11,
		paddingHorizontal: 16,
		borderRadius: radii.lg,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.surface,
	},
	outlineBtnHover: {
		backgroundColor: colors.fieldSoft,
	},
	outlineBtnDanger: {
		borderColor: 'rgba(240,88,75,0.45)',
	},
	outlineBtnDangerHover: {
		backgroundColor: 'rgba(240,88,75,0.05)',
	},
	outlineBtnTxt: {
		fontFamily: font.semibold,
		fontSize: 13.5,
		color: colors.textSub,
	},
	outlineBtnTxtDanger: {
		color: colors.redInk,
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

// Design tokens for the Rivus dashboard, ported from the Rivus.dc.html design.
// Single source of truth for colors, typography, radii, spacing and shadows so
// every screen stays on-brand. Light theme only (the desktop design is light).

export const colors = {
	// Surfaces
	appBg: '#f6f7fb',
	sidebar: '#101019',
	surface: '#ffffff',
	surfaceAlt: '#fbfbfd',
	field: '#f3f4f8',
	fieldSoft: '#f6f7fb',

	// Hairlines / borders
	border: '#e9eaf0',
	borderSoft: '#eef0f4',
	borderField: '#ececf2',
	borderRow: '#f3f4f8',

	// Text
	text: '#16161f',
	textSub: '#5a5b68',
	textBody: '#6b6e7e',
	textMuted: '#8a8b99',
	textFaint: '#9a9bb0',
	textGhost: '#a6a8b4',
	textHint: '#b6b8c4',

	// Brand
	brandCyan: '#1ebefa',
	brandPurple: '#6e1ec8',
	brandPurpleInk: '#3a2a52',

	// Status
	green: '#1fb573',
	amber: '#f0a020',
	amberInk: '#a4720f',
	red: '#f0584b',
	redInk: '#d2503f',

	// Tints
	purpleTint: '#efe6f8',
	purpleTintInk: '#6e1ec8',

	// Sidebar
	sidebarText: '#9a9bb0',
	sidebarTextActive: '#ffffff',
	sidebarDim: '#7c7d8e',
	sidebarHeading: '#e9eaf0',

	// Avatars / chips
	avatarBg: '#eceef4',
	avatarText: '#4a4b58',
	chipBg: '#eef0f4',

	// Controls
	switchTrackOff: '#d9dbe6',
} as const;

// The signature Rivus gradient (135deg, cyan -> purple).
export const brandGradient = ['#1ebefa', '#6e1ec8'] as const;
// Direction tuples for expo-linear-gradient (approximates a 135deg diagonal).
export const gradientDiagonal = {
	start: { x: 0, y: 0 },
	end: { x: 1, y: 1 },
} as const;
export const gradientVertical = {
	start: { x: 0, y: 0 },
	end: { x: 0, y: 1 },
} as const;

// Dark "briefing" panel gradient (cyan/purple over near-black).
export const briefingGradient = ['#15131f', '#241836'] as const;
export const briefingGradientWide = ['#13131f', '#1b1530'] as const;

export const radii = {
	sm: 8,
	md: 10,
	lg: 11,
	xl: 12,
	xxl: 14,
	card: 16,
	pill: 999,
} as const;

export const font = {
	light: 'Montserrat_300Light',
	regular: 'Montserrat_400Regular',
	medium: 'Montserrat_500Medium',
	semibold: 'Montserrat_600SemiBold',
	bold: 'Montserrat_700Bold',
} as const;

// Subtle card shadow. react-native-web maps these to box-shadow; native uses
// shadow*/elevation. Kept intentionally light to match the border-led design.
export const shadowCard = {
	shadowColor: '#141428',
	shadowOpacity: 0.05,
	shadowRadius: 3,
	shadowOffset: { width: 0, height: 1 },
	elevation: 1,
} as const;

export const shadowSoft = {
	shadowColor: '#141428',
	shadowOpacity: 0.08,
	shadowRadius: 2,
	shadowOffset: { width: 0, height: 1 },
	elevation: 2,
} as const;

// Width below which the persistent sidebar collapses to the narrow (mobile)
// layout with a bottom tab bar.
export const SIDEBAR_BREAKPOINT = 880;
export const SIDEBAR_WIDTH = 244;

// Height of the narrow-layout bottom tab bar, excluding the safe-area inset that
// is padded on below it. Shared so the floating chat button can clear the bar.
export const MOBILE_TABBAR_HEIGHT = 56;

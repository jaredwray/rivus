import { Feather } from '@expo/vector-icons';
import {
	Montserrat_300Light,
	Montserrat_400Regular,
	Montserrat_500Medium,
	Montserrat_600SemiBold,
	Montserrat_700Bold,
	useFonts,
} from '@expo-google-fonts/montserrat';
import { Redirect, Slot, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import {
	ActivityIndicator,
	Pressable,
	type StyleProp,
	StyleSheet,
	useWindowDimensions,
	View,
	type ViewStyle,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthProvider, initialsOf, roleLabel, useAuth } from '@/src/auth/AuthContext';
import { AuthScreen } from '@/src/auth/AuthScreen';
import { RivusWordmark } from '@/src/brand/RivusLogo';
import { CompanySwitcher } from '@/src/components/CompanySwitcher';
import { BrandGradient } from '@/src/components/Gradient';
import { RivusChat } from '@/src/components/RivusChat';
import { Avatar, Icon, Txt } from '@/src/components/ui';
import { InboxProvider, useInbox } from '@/src/inbox/InboxContext';
import { NotificationsBell } from '@/src/notifications/NotificationsBell';
import { NotificationsProvider } from '@/src/notifications/NotificationsContext';
import { installFocusRing } from '@/src/theme/focusRing';
import {
	colors,
	font,
	MOBILE_TABBAR_HEIGHT,
	radii,
	SIDEBAR_BREAKPOINT,
	SIDEBAR_WIDTH,
	shadowSoft,
} from '@/src/theme/tokens';

type FeatherName = React.ComponentProps<typeof Feather>['name'];
type NavItem = {
	href: string;
	label: string;
	icon: FeatherName;
	badge?: string;
	/** When true, only Owners see this destination (account settings). */
	ownerOnly?: boolean;
};

const NAV: NavItem[] = [
	{ href: '/', label: 'Home', icon: 'home' },
	{ href: '/inbox', label: 'Inbox', icon: 'inbox' },
	{ href: '/schedule', label: 'Schedule', icon: 'calendar' },
	{ href: '/customers', label: 'Customers', icon: 'users' },
	{ href: '/marketing', label: 'Marketing', icon: 'trending-up' },
	{ href: '/knowledge', label: 'Knowledge', icon: 'book' },
	{ href: '/team', label: 'Team', icon: 'user-check' },
	{ href: '/settings', label: 'Settings', icon: 'settings', ownerOnly: true },
];

/** Hide owner-only destinations from managers and members. */
function navFor(role: string | undefined): NavItem[] {
	return NAV.filter((item) => !item.ownerOnly || role === 'owner');
}

/**
 * The badge to show on a nav item. The Inbox badge is live — the count of
 * conversations that need a human — so it reflects the real backlog (and hides at
 * zero) instead of a hard-coded number. Other items use their static badge.
 */
function badgeFor(item: NavItem, inboxCount: number): string | undefined {
	if (item.href === '/inbox') {
		return inboxCount > 0 ? String(inboxCount) : undefined;
	}
	return item.badge;
}

function isActive(pathname: string, href: string): boolean {
	return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

/** Paths that render their own auth screen instead of the dashboard shell. */
const AUTH_PATHS = ['/login', '/signup', '/accept-invite'];

function isAuthPath(pathname: string): boolean {
	const normalized = pathname.replace(/\/+$/, '') || '/';
	return AUTH_PATHS.includes(normalized);
}

export default function RootLayout() {
	const [loaded] = useFonts({
		Montserrat_300Light,
		Montserrat_400Regular,
		Montserrat_500Medium,
		Montserrat_600SemiBold,
		Montserrat_700Bold,
	});

	// Web only: replace the browser's default focus outline with a clean,
	// keyboard-only brand ring (see installFocusRing). No-op on native.
	useEffect(() => {
		installFocusRing();
	}, []);

	return (
		<SafeAreaProvider>
			<StatusBar style="light" />
			<AuthProvider>
				{loaded ? (
					<Gate />
				) : (
					<View style={styles.loading}>
						<ActivityIndicator color={colors.brandPurple} />
					</View>
				)}
			</AuthProvider>
		</SafeAreaProvider>
	);
}

/** Show the auth screens until there's a session, then the dashboard shell. */
function Gate() {
	const { session, restoring } = useAuth();
	const pathname = usePathname();
	const onAuthRoute = isAuthPath(pathname);

	// On web load we check the session cookie first; hold on a spinner so a valid
	// session doesn't flash the sign-in screen before `me()` resolves.
	if (restoring) {
		return (
			<View style={styles.loading}>
				<ActivityIndicator color={colors.brandPurple} />
			</View>
		);
	}

	if (!session) {
		// Signed out: /login, /signup and /accept-invite render their own screen;
		// every other path (the root included) falls back to the sign-in screen.
		return onAuthRoute ? <Slot /> : <AuthScreen initialMode="signin" />;
	}

	// Signed in: the auth routes aren't meant for an active session.
	if (onAuthRoute) {
		return <Redirect href="/" />;
	}
	return (
		<NotificationsProvider>
			<InboxProvider>
				<Shell />
			</InboxProvider>
		</NotificationsProvider>
	);
}

function Shell() {
	const { width } = useWindowDimensions();
	const insets = useSafeAreaInsets();
	const { isStaff, session } = useAuth();
	const wide = width >= SIDEBAR_BREAKPOINT;

	// Measured height of the bottom tab bar (it has no fixed height, so larger
	// text settings or a wrapped label can grow it). The "More" sheet anchors to
	// this so it always clears the real bar; the constant is the pre-measure
	// default.
	const [tabBarHeight, setTabBarHeight] = useState(MOBILE_TABBAR_HEIGHT + insets.bottom);

	// Narrow layout opens the agent chat full screen from the top bar's chat icon
	// (there's no floating launcher on mobile), so the Shell owns the open state.
	const [chatOpen, setChatOpen] = useState(false);

	// Remount the agent chat when the active account changes (a staff "switch
	// company" swaps the session in place). Its transcript and answers are
	// tenant-specific, so keying on the account id discards one company's
	// conversation instead of leaking it — or re-sending it — into the next.
	const chatKey = session?.account.id;

	if (wide) {
		return (
			<View style={styles.rootRow}>
				<Sidebar />
				<View style={styles.main}>
					<TopBar />
					<View style={styles.content}>
						<Slot />
					</View>
				</View>
				<RivusChat key={chatKey} />
			</View>
		);
	}

	return (
		<View style={styles.rootColumn}>
			<CompactBar onOpenChat={() => setChatOpen(true)} />
			{/* Only staff get the company switcher; non-staff have no company row at all. */}
			{isStaff ? (
				<View style={styles.compactCompany}>
					<CompanySwitcher />
				</View>
			) : null}
			<View style={styles.content}>
				<Slot />
			</View>
			{/* On mobile the chat opens full screen from the top bar's chat icon rather
			    than from a floating launcher, so there's nothing to clear the tab bar. */}
			<RivusChat
				key={chatKey}
				variant="fullscreen"
				open={chatOpen}
				onClose={() => setChatOpen(false)}
			/>
			<BottomTabBar height={tabBarHeight} onHeight={setTabBarHeight} />
		</View>
	);
}

/**
 * The Rivus wordmark, linking back to Home. Shared by the wide sidebar and the
 * compact top bar so the brand mark is a consistent "return to dashboard" tap
 * target on every breakpoint.
 */
function HomeLink({ height, style }: { height: number; style?: StyleProp<ViewStyle> }) {
	const router = useRouter();
	return (
		<Pressable
			style={style}
			onPress={() => router.push('/')}
			accessibilityRole="link"
			accessibilityLabel="Rivus home"
			hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
		>
			<RivusWordmark height={height} />
		</Pressable>
	);
}

/* ------------------------------- Wide layout ------------------------------ */

function Sidebar() {
	const pathname = usePathname();
	const router = useRouter();
	const { session, signOut } = useAuth();
	const { needsAttentionCount } = useInbox();
	const userName = session?.user.name ?? '';
	const role = session ? roleLabel(session.role) : '';

	return (
		<View style={styles.sidebar}>
			<HomeLink height={24} style={styles.sidebarLogo} />

			<View style={styles.nav}>
				{navFor(session?.role).map((item) => {
					const active = isActive(pathname, item.href);
					const badge = badgeFor(item, needsAttentionCount);
					return (
						<Pressable
							key={item.href}
							onPress={() => router.push(item.href)}
							style={[styles.navItem, active && styles.navItemActive]}
						>
							{active ? <BrandGradient vertical style={styles.navActiveBar} /> : null}
							<Feather
								name={item.icon}
								size={18}
								color={active ? colors.sidebarTextActive : colors.sidebarText}
							/>
							<Txt style={[styles.navLabel, active && styles.navLabelActive]}>{item.label}</Txt>
							{badge ? (
								<BrandGradient style={styles.navBadge}>
									<Txt style={styles.navBadgeTxt}>{badge}</Txt>
								</BrandGradient>
							) : null}
						</Pressable>
					);
				})}
			</View>

			<View style={styles.sidebarFooter}>
				<Pressable style={styles.userRow} onPress={signOut}>
					<Avatar
						initials={userName ? initialsOf(userName) : '–'}
						size={30}
						background="#2a2a3a"
						color="#cfd0dc"
					/>
					<View style={{ flex: 1 }}>
						<Txt style={styles.userName}>{userName}</Txt>
						<Txt style={styles.userRole}>{role}</Txt>
					</View>
					<Feather name="log-out" size={15} color={colors.sidebarDim} />
				</Pressable>
			</View>
		</View>
	);
}

function TopBar() {
	return (
		<View style={styles.topbar}>
			<CompanySwitcher />

			<View style={styles.searchWrap}>
				<View style={styles.search}>
					<Icon name="search" size={16} color={colors.textFaint} />
					<Txt style={styles.searchTxt} numberOfLines={1}>
						Search customers, jobs, messages…
					</Txt>
				</View>
			</View>

			<View style={styles.topbarRight}>
				<NotificationsBell variant="topbar" />
			</View>
		</View>
	);
}

/* ------------------------------ Narrow layout ----------------------------- */

function CompactBar({ onOpenChat }: { onOpenChat: () => void }) {
	const insets = useSafeAreaInsets();
	return (
		<View style={[styles.compactBar, { paddingTop: insets.top + 12 }]}>
			<HomeLink height={20} />
			<View style={styles.compactRight}>
				{/* Chat with Rivus — sits right before the bell and opens the agent chat
				    full screen (the mobile layout has no floating chat launcher). */}
				<Pressable
					style={styles.compactIconBtn}
					onPress={onOpenChat}
					accessibilityRole="button"
					accessibilityLabel="Open Rivus chat"
					hitSlop={{ top: 5, bottom: 5, left: 5, right: 5 }}
				>
					<Feather name="message-circle" size={18} color="#cfd0dc" />
				</Pressable>
				<NotificationsBell variant="compact" />
			</View>
		</View>
	);
}

// How many destinations sit directly on the bar; the rest fold into "More".
// Four primary tabs + More keeps the bar within the ~5-slot mobile convention.
const PRIMARY_TAB_COUNT = 4;

/**
 * Fixed bottom tab bar — the narrow-layout counterpart to the wide Sidebar.
 * Shows the primary destinations as tabs and folds the rest behind a "More"
 * tab that opens a sheet just above the bar.
 */
function BottomTabBar({ height, onHeight }: { height: number; onHeight: (h: number) => void }) {
	const pathname = usePathname();
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const { session } = useAuth();
	const { needsAttentionCount } = useInbox();
	const [moreOpen, setMoreOpen] = useState(false);

	const items = navFor(session?.role);
	const primary = items.slice(0, PRIMARY_TAB_COUNT);
	const overflow = items.slice(PRIMARY_TAB_COUNT);

	const overflowActive = overflow.some((item) => isActive(pathname, item.href));
	const overflowHasBadge = overflow.some((item) => badgeFor(item, needsAttentionCount));

	function go(href: string) {
		setMoreOpen(false);
		router.push(href);
	}

	return (
		<>
			{moreOpen && overflow.length > 0 ? (
				<MoreSheet items={overflow} barHeight={height} onClose={() => setMoreOpen(false)} />
			) : null}

			<View
				style={[styles.tabbar, { paddingBottom: insets.bottom + 6 }]}
				onLayout={(event) => onHeight(event.nativeEvent.layout.height)}
			>
				{primary.map((item) => (
					<TabButton
						key={item.href}
						icon={item.icon}
						label={item.label}
						badge={badgeFor(item, needsAttentionCount)}
						active={isActive(pathname, item.href)}
						onPress={() => go(item.href)}
					/>
				))}
				{overflow.length > 0 ? (
					<TabButton
						icon="more-horizontal"
						label="More"
						active={overflowActive || moreOpen}
						dot={overflowHasBadge}
						onPress={() => setMoreOpen((open) => !open)}
					/>
				) : null}
			</View>
		</>
	);
}

function TabButton({
	icon,
	label,
	active,
	badge,
	dot,
	onPress,
}: {
	icon: FeatherName;
	label: string;
	active: boolean;
	badge?: string;
	dot?: boolean;
	onPress: () => void;
}) {
	return (
		<Pressable
			style={styles.tab}
			onPress={onPress}
			accessibilityRole="button"
			accessibilityState={{ selected: active }}
			accessibilityLabel={label}
		>
			{active ? <BrandGradient style={styles.tabIndicator} /> : null}
			<View>
				<Feather name={icon} size={22} color={active ? colors.brandPurple : colors.textMuted} />
				{badge ? (
					<View style={styles.tabBadge}>
						<Txt style={styles.tabBadgeTxt}>{badge}</Txt>
					</View>
				) : dot ? (
					<View style={styles.tabDot} />
				) : null}
			</View>
			<Txt style={[styles.tabLabel, active && styles.tabLabelActive]} numberOfLines={1}>
				{label}
			</Txt>
		</Pressable>
	);
}

/** Overflow destinations (and sign-out) for the bottom bar's "More" tab. */
function MoreSheet({
	items,
	barHeight,
	onClose,
}: {
	items: NavItem[];
	barHeight: number;
	onClose: () => void;
}) {
	const pathname = usePathname();
	const router = useRouter();
	const { session, signOut } = useAuth();
	const { needsAttentionCount } = useInbox();
	const userName = session?.user.name ?? '';
	const role = session ? roleLabel(session.role) : '';

	return (
		<>
			<Pressable
				style={styles.sheetBackdrop}
				onPress={onClose}
				accessibilityRole="button"
				accessibilityLabel="Close menu"
			/>
			<View style={[styles.sheet, { bottom: barHeight }]}>
				<View style={styles.sheetHandle} />
				{items.map((item) => {
					const active = isActive(pathname, item.href);
					const badge = badgeFor(item, needsAttentionCount);
					return (
						<Pressable
							key={item.href}
							style={[styles.sheetRow, active && styles.sheetRowActive]}
							onPress={() => {
								onClose();
								router.push(item.href);
							}}
							accessibilityRole="button"
							accessibilityState={{ selected: active }}
						>
							<Feather
								name={item.icon}
								size={18}
								color={active ? colors.brandPurple : colors.textSub}
							/>
							<Txt style={[styles.sheetLabel, active && styles.sheetLabelActive]} numberOfLines={1}>
								{item.label}
							</Txt>
							{badge ? (
								<BrandGradient style={styles.sheetBadge}>
									<Txt style={styles.sheetBadgeTxt}>{badge}</Txt>
								</BrandGradient>
							) : null}
						</Pressable>
					);
				})}

				<View style={styles.sheetDivider} />
				<Pressable
					style={styles.sheetUser}
					onPress={() => {
						onClose();
						signOut();
					}}
					accessibilityRole="button"
					accessibilityLabel="Sign out"
				>
					<Avatar
						initials={userName ? initialsOf(userName) : '–'}
						size={32}
						background={colors.avatarBg}
						color={colors.avatarText}
					/>
					<View style={{ flex: 1 }}>
						<Txt style={styles.sheetUserName}>{userName}</Txt>
						<Txt style={styles.sheetUserRole}>{role}</Txt>
					</View>
					<Feather name="log-out" size={16} color={colors.textMuted} />
				</Pressable>
			</View>
		</>
	);
}

const styles = StyleSheet.create({
	loading: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: colors.appBg,
	},
	rootRow: {
		flex: 1,
		flexDirection: 'row',
		backgroundColor: colors.appBg,
	},
	rootColumn: {
		flex: 1,
		backgroundColor: colors.appBg,
	},
	main: {
		flex: 1,
		minWidth: 0,
	},
	content: {
		flex: 1,
		minHeight: 0,
		backgroundColor: colors.appBg,
	},

	// Sidebar
	sidebar: {
		width: SIDEBAR_WIDTH,
		backgroundColor: colors.sidebar,
		paddingHorizontal: 14,
		paddingVertical: 18,
	},
	sidebarLogo: {
		paddingHorizontal: 8,
		paddingTop: 6,
		paddingBottom: 22,
	},
	nav: {
		flex: 1,
		gap: 3,
	},
	navItem: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		paddingVertical: 10,
		paddingHorizontal: 12,
		borderRadius: radii.md,
	},
	navItemActive: {
		backgroundColor: 'rgba(255,255,255,0.07)',
	},
	navActiveBar: {
		position: 'absolute',
		left: -14,
		top: 9,
		bottom: 9,
		width: 3,
		borderTopRightRadius: 3,
		borderBottomRightRadius: 3,
	},
	navLabel: {
		flex: 1,
		fontFamily: font.medium,
		fontSize: 14,
		color: colors.sidebarText,
	},
	navLabelActive: {
		color: colors.sidebarTextActive,
	},
	navBadge: {
		paddingVertical: 1,
		paddingHorizontal: 7,
		borderRadius: radii.pill,
	},
	navBadgeTxt: {
		fontFamily: font.semibold,
		fontSize: 11,
		color: '#fff',
	},
	sidebarFooter: {
		borderTopWidth: 1,
		borderTopColor: 'rgba(255,255,255,0.08)',
		paddingTop: 12,
		marginTop: 8,
	},
	userRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		paddingVertical: 8,
		paddingHorizontal: 8,
		borderRadius: radii.md,
	},
	userName: {
		fontFamily: font.semibold,
		fontSize: 13,
		color: colors.sidebarHeading,
	},
	userRole: {
		fontFamily: font.regular,
		fontSize: 11,
		color: colors.sidebarDim,
	},

	// Topbar
	topbar: {
		height: 64,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 18,
		paddingHorizontal: 26,
		borderBottomWidth: 1,
		borderBottomColor: colors.border,
		backgroundColor: colors.surface,
	},
	searchWrap: {
		flex: 1,
		alignItems: 'center',
	},
	search: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 9,
		width: 420,
		maxWidth: '100%',
		backgroundColor: colors.field,
		borderWidth: 1,
		borderColor: colors.borderField,
		borderRadius: radii.md,
		paddingVertical: 8,
		paddingHorizontal: 13,
	},
	searchTxt: {
		flex: 1,
		fontSize: 13,
		color: colors.textFaint,
	},
	topbarRight: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 14,
	},
	// Compact (narrow) bar
	compactBar: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		backgroundColor: colors.sidebar,
		paddingHorizontal: 18,
		paddingBottom: 12,
	},
	compactRight: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 14,
	},
	compactIconBtn: {
		width: 34,
		height: 34,
		alignItems: 'center',
		justifyContent: 'center',
	},
	compactCompany: {
		backgroundColor: colors.surface,
		borderBottomWidth: 1,
		borderBottomColor: colors.border,
		paddingHorizontal: 18,
		paddingVertical: 10,
	},
	// Bottom tab bar (narrow layout)
	tabbar: {
		flexDirection: 'row',
		alignItems: 'flex-start',
		justifyContent: 'space-around',
		backgroundColor: colors.surface,
		borderTopWidth: 1,
		borderTopColor: colors.border,
		paddingTop: 8,
		paddingHorizontal: 6,
	},
	tab: {
		flex: 1,
		alignItems: 'center',
		gap: 4,
		paddingVertical: 2,
	},
	tabIndicator: {
		position: 'absolute',
		top: -8,
		width: 26,
		height: 3,
		borderBottomLeftRadius: 3,
		borderBottomRightRadius: 3,
	},
	tabLabel: {
		fontFamily: font.semibold,
		fontSize: 10.5,
		color: colors.textMuted,
	},
	tabLabelActive: {
		color: colors.brandPurple,
	},
	tabBadge: {
		position: 'absolute',
		top: -5,
		right: -10,
		minWidth: 16,
		height: 16,
		paddingHorizontal: 4,
		borderRadius: radii.pill,
		backgroundColor: colors.red,
		alignItems: 'center',
		justifyContent: 'center',
	},
	tabBadgeTxt: {
		fontFamily: font.semibold,
		fontSize: 10,
		color: '#fff',
	},
	tabDot: {
		position: 'absolute',
		top: -2,
		right: -6,
		width: 8,
		height: 8,
		borderRadius: 4,
		backgroundColor: colors.red,
	},

	// "More" overflow sheet
	sheetBackdrop: {
		position: 'absolute',
		top: 0,
		left: 0,
		right: 0,
		bottom: 0,
		backgroundColor: 'rgba(16,16,25,0.35)',
	},
	sheet: {
		position: 'absolute',
		left: 0,
		right: 0,
		backgroundColor: colors.surface,
		borderTopLeftRadius: radii.card,
		borderTopRightRadius: radii.card,
		borderTopWidth: 1,
		borderColor: colors.border,
		paddingHorizontal: 14,
		paddingTop: 8,
		paddingBottom: 10,
		...shadowSoft,
	},
	sheetHandle: {
		alignSelf: 'center',
		width: 38,
		height: 4,
		borderRadius: radii.pill,
		backgroundColor: colors.border,
		marginBottom: 8,
	},
	sheetRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		paddingVertical: 11,
		paddingHorizontal: 8,
		borderRadius: radii.md,
	},
	sheetRowActive: {
		backgroundColor: colors.chipBg,
	},
	sheetLabel: {
		flex: 1,
		fontFamily: font.medium,
		fontSize: 14,
		color: colors.text,
	},
	sheetLabelActive: {
		fontFamily: font.semibold,
		color: colors.brandPurple,
	},
	sheetBadge: {
		paddingVertical: 1,
		paddingHorizontal: 7,
		borderRadius: radii.pill,
	},
	sheetBadgeTxt: {
		fontFamily: font.semibold,
		fontSize: 11,
		color: '#fff',
	},
	sheetDivider: {
		height: 1,
		backgroundColor: colors.border,
		marginVertical: 6,
	},
	sheetUser: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		paddingVertical: 8,
		paddingHorizontal: 8,
		borderRadius: radii.md,
	},
	sheetUserName: {
		fontFamily: font.semibold,
		fontSize: 13,
		color: colors.text,
	},
	sheetUserRole: {
		fontFamily: font.regular,
		fontSize: 11,
		color: colors.textMuted,
	},
});

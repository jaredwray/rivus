import { Feather } from '@expo/vector-icons';
import {
	Montserrat_300Light,
	Montserrat_400Regular,
	Montserrat_500Medium,
	Montserrat_600SemiBold,
	Montserrat_700Bold,
	useFonts,
} from '@expo-google-fonts/montserrat';
import { Slot, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
	ActivityIndicator,
	Pressable,
	ScrollView,
	StyleSheet,
	useWindowDimensions,
	View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthProvider, initialsOf, roleLabel, useAuth } from '@/src/auth/AuthContext';
import { AuthScreen } from '@/src/auth/AuthScreen';
import { RivusWordmark } from '@/src/brand/RivusLogo';
import { BrandGradient } from '@/src/components/Gradient';
import { Avatar, Dot, Icon, RivusStatusChip, Txt } from '@/src/components/ui';
import { colors, font, radii, SIDEBAR_BREAKPOINT, SIDEBAR_WIDTH } from '@/src/theme/tokens';

type FeatherName = React.ComponentProps<typeof Feather>['name'];
type NavItem = { href: string; label: string; icon: FeatherName; badge?: string };

const NAV: NavItem[] = [
	{ href: '/', label: 'Home', icon: 'home' },
	{ href: '/inbox', label: 'Inbox', icon: 'inbox', badge: '2' },
	{ href: '/schedule', label: 'Schedule', icon: 'calendar' },
	{ href: '/customers', label: 'Customers', icon: 'users' },
	{ href: '/marketing', label: 'Marketing', icon: 'trending-up' },
	{ href: '/knowledge', label: 'Knowledge', icon: 'book' },
	{ href: '/team', label: 'Team', icon: 'user-check' },
];

function isActive(pathname: string, href: string): boolean {
	return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

export default function RootLayout() {
	const [loaded] = useFonts({
		Montserrat_300Light,
		Montserrat_400Regular,
		Montserrat_500Medium,
		Montserrat_600SemiBold,
		Montserrat_700Bold,
	});

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
	const { session } = useAuth();
	if (!session) {
		return <AuthScreen />;
	}
	return <Shell />;
}

function Shell() {
	const { width } = useWindowDimensions();
	const wide = width >= SIDEBAR_BREAKPOINT;

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
			</View>
		);
	}

	return (
		<View style={styles.rootColumn}>
			<CompactBar />
			<NavStrip />
			<View style={styles.content}>
				<Slot />
			</View>
		</View>
	);
}

/* ------------------------------- Wide layout ------------------------------ */

function Sidebar() {
	const pathname = usePathname();
	const router = useRouter();
	const { session, signOut } = useAuth();
	const userName = session?.user.name ?? '';
	const role = session ? roleLabel(session.role) : '';

	return (
		<View style={styles.sidebar}>
			<View style={styles.sidebarLogo}>
				<RivusWordmark height={24} />
			</View>

			<View style={styles.nav}>
				{NAV.map((item) => {
					const active = isActive(pathname, item.href);
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
							{item.badge ? (
								<BrandGradient style={styles.navBadge}>
									<Txt style={styles.navBadgeTxt}>{item.badge}</Txt>
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
	const { session } = useAuth();
	const accountName = session?.account.name ?? 'Your business';
	const companySub = session?.account.address || session?.account.timezone || '';

	return (
		<View style={styles.topbar}>
			<Pressable style={styles.company}>
				<View style={styles.companyMark}>
					<Txt style={styles.companyMarkTxt}>{accountName.charAt(0).toUpperCase()}</Txt>
				</View>
				<View>
					<Txt style={styles.companyName}>{accountName}</Txt>
					{companySub ? <Txt style={styles.companySub}>{companySub}</Txt> : null}
				</View>
				<Feather name="chevron-down" size={15} color={colors.textHint} />
			</Pressable>

			<View style={styles.searchWrap}>
				<View style={styles.search}>
					<Icon name="search" size={16} color={colors.textFaint} />
					<Txt style={styles.searchTxt} numberOfLines={1}>
						Search customers, jobs, messages…
					</Txt>
				</View>
			</View>

			<View style={styles.topbarRight}>
				<RivusStatusChip label="Rivus is online" />
				<Pressable style={styles.iconBtn}>
					<Icon name="bell" size={18} color={colors.textSub} />
					<View style={styles.bellDot} />
				</Pressable>
			</View>
		</View>
	);
}

/* ------------------------------ Narrow layout ----------------------------- */

function CompactBar() {
	const insets = useSafeAreaInsets();
	return (
		<View style={[styles.compactBar, { paddingTop: insets.top + 12 }]}>
			<RivusWordmark height={20} />
			<View style={styles.compactRight}>
				<View style={styles.compactStatus}>
					<Dot color={colors.green} size={7} />
					<Txt style={styles.compactStatusTxt}>Online</Txt>
				</View>
				<Pressable style={styles.compactBell}>
					<Feather name="bell" size={18} color="#cfd0dc" />
					<View style={styles.bellDot} />
				</Pressable>
			</View>
		</View>
	);
}

function NavStrip() {
	const pathname = usePathname();
	const router = useRouter();
	return (
		<View style={styles.navStripWrap}>
			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				contentContainerStyle={styles.navStrip}
			>
				{NAV.map((item) => {
					const active = isActive(pathname, item.href);
					const content = (
						<>
							<Feather name={item.icon} size={15} color={active ? '#fff' : colors.textSub} />
							<Txt style={[styles.chipTxt, active && styles.chipTxtActive]}>{item.label}</Txt>
							{item.badge ? (
								<View style={[styles.chipBadge, active && styles.chipBadgeActive]}>
									<Txt style={[styles.chipBadgeTxt, active && styles.chipBadgeTxtActive]}>
										{item.badge}
									</Txt>
								</View>
							) : null}
						</>
					);
					return (
						<Pressable key={item.href} onPress={() => router.push(item.href)}>
							{active ? (
								<BrandGradient style={styles.chip}>{content}</BrandGradient>
							) : (
								<View style={[styles.chip, styles.chipInactive]}>{content}</View>
							)}
						</Pressable>
					);
				})}
			</ScrollView>
		</View>
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
	company: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 10,
	},
	companyMark: {
		width: 30,
		height: 30,
		borderRadius: radii.sm,
		backgroundColor: '#0e2a36',
		alignItems: 'center',
		justifyContent: 'center',
	},
	companyMarkTxt: {
		fontFamily: font.bold,
		fontSize: 13,
		color: colors.brandCyan,
	},
	companyName: {
		fontFamily: font.semibold,
		fontSize: 13.5,
	},
	companySub: {
		fontFamily: font.regular,
		fontSize: 11,
		color: colors.textMuted,
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
	iconBtn: {
		width: 38,
		height: 38,
		borderRadius: radii.md,
		borderWidth: 1,
		borderColor: colors.borderField,
		backgroundColor: colors.surface,
		alignItems: 'center',
		justifyContent: 'center',
	},
	bellDot: {
		position: 'absolute',
		top: 8,
		right: 9,
		width: 7,
		height: 7,
		borderRadius: 4,
		backgroundColor: colors.red,
		borderWidth: 1.5,
		borderColor: colors.surface,
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
	compactStatus: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 7,
	},
	compactStatusTxt: {
		fontFamily: font.semibold,
		fontSize: 12,
		color: '#cfd0dc',
	},
	compactBell: {
		width: 34,
		height: 34,
		alignItems: 'center',
		justifyContent: 'center',
	},
	navStripWrap: {
		backgroundColor: colors.surface,
		borderBottomWidth: 1,
		borderBottomColor: colors.border,
	},
	navStrip: {
		flexDirection: 'row',
		gap: 8,
		paddingHorizontal: 16,
		paddingVertical: 11,
	},
	chip: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 7,
		paddingVertical: 8,
		paddingHorizontal: 13,
		borderRadius: radii.pill,
	},
	chipInactive: {
		backgroundColor: colors.chipBg,
	},
	chipTxt: {
		fontFamily: font.semibold,
		fontSize: 12.5,
		color: colors.textSub,
	},
	chipTxtActive: {
		color: '#fff',
	},
	chipBadge: {
		paddingVertical: 0,
		paddingHorizontal: 6,
		borderRadius: radii.pill,
		backgroundColor: 'rgba(255,255,255,0.3)',
	},
	chipBadgeActive: {
		backgroundColor: 'rgba(255,255,255,0.3)',
	},
	chipBadgeTxt: {
		fontFamily: font.semibold,
		fontSize: 11,
		color: colors.textSub,
	},
	chipBadgeTxtActive: {
		color: '#fff',
	},
});

import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Txt } from '@/src/components/ui';
import { colors, font, radii, shadowSoft } from '@/src/theme/tokens';
import { useNotifications } from './NotificationsContext';
import { NotificationsView } from './NotificationsView';

/**
 * The header bell with a live unread badge. On the wide layout (`topbar`) it
 * opens a popover panel anchored under the bar; on the narrow layout (`compact`)
 * it routes to the full `/notifications` screen — the more native pattern on a
 * phone. The unread badge is solid Danger red (never the signature gradient,
 * per the design system).
 */
export function NotificationsBell({ variant }: { variant: 'topbar' | 'compact' }) {
	const router = useRouter();
	const { unreadCount } = useNotifications();
	const [panelOpen, setPanelOpen] = useState(false);
	const isTopbar = variant === 'topbar';

	function onPress() {
		if (isTopbar) {
			setPanelOpen((open) => !open);
		} else {
			router.push('/notifications');
		}
	}

	return (
		<>
			<Pressable
				onPress={onPress}
				style={isTopbar ? styles.topbarBtn : styles.compactBtn}
				accessibilityRole="button"
				accessibilityLabel={
					unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
				}
				hitSlop={
					isTopbar
						? { top: 3, bottom: 3, left: 3, right: 3 }
						: { top: 5, bottom: 5, left: 5, right: 5 }
				}
			>
				<Feather name="bell" size={18} color={isTopbar ? colors.textSub : '#cfd0dc'} />
				{unreadCount > 0 ? (
					<View style={styles.badge}>
						<Txt style={styles.badgeText}>{unreadCount > 9 ? '9+' : String(unreadCount)}</Txt>
					</View>
				) : null}
			</Pressable>

			{isTopbar ? (
				<Modal
					visible={panelOpen}
					transparent
					animationType="fade"
					onRequestClose={() => setPanelOpen(false)}
				>
					<Pressable style={styles.backdrop} onPress={() => setPanelOpen(false)}>
						{/* Stop propagation so taps inside the panel don't close it. */}
						<Pressable style={styles.panel} onPress={() => {}}>
							<View style={styles.panelHead}>
								<Txt style={styles.panelTitle}>Notifications</Txt>
								<Pressable
									onPress={() => setPanelOpen(false)}
									accessibilityRole="button"
									accessibilityLabel="Close notifications"
									hitSlop={8}
								>
									<Feather name="x" size={18} color={colors.textMuted} />
								</Pressable>
							</View>
							<ScrollView
								style={styles.panelScroll}
								contentContainerStyle={styles.panelScrollContent}
							>
								<NotificationsView
									onNavigate={(href) => {
										setPanelOpen(false);
										router.push(href);
									}}
								/>
							</ScrollView>
							<Pressable
								style={styles.seeAll}
								onPress={() => {
									setPanelOpen(false);
									router.push('/notifications');
								}}
								accessibilityRole="button"
							>
								<Txt style={styles.seeAllText}>See all notifications</Txt>
							</Pressable>
						</Pressable>
					</Pressable>
				</Modal>
			) : null}
		</>
	);
}

const styles = StyleSheet.create({
	topbarBtn: {
		width: 38,
		height: 38,
		borderRadius: radii.md,
		borderWidth: 1,
		borderColor: colors.borderField,
		backgroundColor: colors.surface,
		alignItems: 'center',
		justifyContent: 'center',
	},
	compactBtn: {
		width: 34,
		height: 34,
		alignItems: 'center',
		justifyContent: 'center',
	},
	badge: {
		position: 'absolute',
		top: 1,
		right: 1,
		minWidth: 16,
		height: 16,
		paddingHorizontal: 4,
		borderRadius: radii.pill,
		backgroundColor: colors.red,
		borderWidth: 1.5,
		borderColor: colors.surface,
		alignItems: 'center',
		justifyContent: 'center',
	},
	badgeText: {
		fontFamily: font.semibold,
		fontSize: 9.5,
		lineHeight: 12,
		color: '#fff',
	},
	backdrop: {
		flex: 1,
		backgroundColor: 'rgba(16,16,25,0.18)',
		alignItems: 'flex-end',
		paddingTop: 60,
		paddingRight: 18,
	},
	panel: {
		width: 372,
		maxWidth: '94%',
		backgroundColor: colors.surface,
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: radii.card,
		overflow: 'hidden',
		...shadowSoft,
	},
	panelHead: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingHorizontal: 16,
		paddingVertical: 13,
		borderBottomWidth: 1,
		borderBottomColor: colors.borderSoft,
	},
	panelTitle: {
		fontFamily: font.semibold,
		fontSize: 15,
		color: colors.text,
	},
	panelScroll: {
		maxHeight: 420,
	},
	panelScrollContent: {
		paddingHorizontal: 14,
		paddingVertical: 6,
	},
	seeAll: {
		alignItems: 'center',
		paddingVertical: 12,
		borderTopWidth: 1,
		borderTopColor: colors.borderSoft,
	},
	seeAllText: {
		fontFamily: font.semibold,
		fontSize: 12.5,
		color: colors.brandPurple,
	},
});

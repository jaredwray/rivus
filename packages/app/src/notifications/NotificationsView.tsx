import { Feather } from '@expo/vector-icons';
import { type ComponentProps, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { ApiError, type Notification } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { Txt } from '@/src/components/ui';
import { colors, font, radii } from '@/src/theme/tokens';
import { useNotifications } from './NotificationsContext';

type FeatherName = ComponentProps<typeof Feather>['name'];

/** A small, recognizable glyph per notification category. */
const TYPE_ICON: Record<string, FeatherName> = {
	job_assigned: 'calendar',
	job_updated: 'calendar',
	job_canceled: 'x-circle',
	invite_accepted: 'user-plus',
	role_changed: 'shield',
	system: 'bell',
};

function iconFor(type: string): FeatherName {
	return TYPE_ICON[type] ?? 'bell';
}

/** Compact "time since" label for a notification's timestamp. */
function timeAgo(iso: string): string {
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) {
		return '';
	}
	const minutes = Math.round((Date.now() - then) / 60_000);
	if (minutes < 1) {
		return 'Just now';
	}
	if (minutes < 60) {
		return `${minutes}m ago`;
	}
	const hours = Math.round(minutes / 60);
	if (hours < 24) {
		return `${hours}h ago`;
	}
	const days = Math.round(hours / 24);
	if (days < 7) {
		return `${days}d ago`;
	}
	return new Date(iso).toLocaleDateString();
}

// One page is plenty for the bell — older items stay reachable by paging later if
// the feature grows; for now the most recent 50 cover the realistic backlog.
const PAGE_SIZE = 50;

/**
 * The notifications feed: loads the signed-in user's notifications and renders
 * them as read/unread rows with per-row "mark read on open" + dismiss, plus a
 * "Mark all read" action. Shared by the full screen and the desktop bell panel;
 * the container supplies the surrounding chrome (title, card, close button).
 *
 * `onNavigate` is called with a notification's `linkHref` when a row is opened,
 * so the screen can route and the panel can route-and-close.
 */
export function NotificationsView({ onNavigate }: { onNavigate?: (href: string) => void }) {
	const { session, client } = useAuth();
	const { refresh: refreshBadge } = useNotifications();
	const [notifications, setNotifications] = useState<Notification[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(
		async (isActive?: () => boolean) => {
			if (!session) {
				return;
			}
			// `isActive` drops a result that resolves after the view unmounted (the
			// desktop panel closing, or navigating away from the screen).
			const stillActive = () => !isActive || isActive();
			setLoading(true);
			setError(null);
			try {
				const result = await client.listNotifications(session.token, { pageSize: PAGE_SIZE });
				if (stillActive()) {
					setNotifications(result.data);
				}
			} catch (caught) {
				if (stillActive()) {
					setError(
						caught instanceof ApiError ? caught.message : 'Could not load your notifications.',
					);
				}
			} finally {
				if (stillActive()) {
					setLoading(false);
				}
			}
		},
		[client, session],
	);

	useEffect(() => {
		let active = true;
		void load(() => active);
		return () => {
			active = false;
		};
	}, [load]);

	const unread = notifications.filter((item) => item.readState === 'unread').length;

	const openRow = useCallback(
		async (item: Notification) => {
			if (!session) {
				return;
			}
			if (item.readState === 'unread') {
				// Flip locally first so the row responds instantly, then persist and let
				// the badge catch up.
				setNotifications((prev) =>
					prev.map((entry) => (entry.id === item.id ? { ...entry, readState: 'read' } : entry)),
				);
				try {
					await client.markNotificationRead(session.token, item.id);
					await refreshBadge();
				} catch {
					// A failed write leaves the optimistic state; the next load reconciles it.
				}
			}
			if (item.linkHref && onNavigate) {
				onNavigate(item.linkHref);
			}
		},
		[client, session, refreshBadge, onNavigate],
	);

	const dismiss = useCallback(
		async (item: Notification) => {
			if (!session) {
				return;
			}
			setNotifications((prev) => prev.filter((entry) => entry.id !== item.id));
			try {
				await client.dismissNotification(session.token, item.id);
				await refreshBadge();
			} catch {
				// Ignore — a reload would restore it if the delete didn't take.
			}
		},
		[client, session, refreshBadge],
	);

	const markAll = useCallback(async () => {
		if (!session || unread === 0) {
			return;
		}
		setNotifications((prev) => prev.map((entry) => ({ ...entry, readState: 'read' })));
		try {
			await client.markAllNotificationsRead(session.token);
			await refreshBadge();
		} catch {
			// Ignore — the badge poll / next load reconciles.
		}
	}, [client, session, unread, refreshBadge]);

	if (loading) {
		return <ActivityIndicator color={colors.brandPurple} style={styles.center} />;
	}
	if (error) {
		return <Txt style={styles.error}>{error}</Txt>;
	}
	if (notifications.length === 0) {
		return (
			<View style={styles.empty}>
				<Feather name="bell" size={22} color={colors.textGhost} />
				<Txt style={styles.emptyText}>You're all caught up.</Txt>
			</View>
		);
	}

	return (
		<View>
			{unread > 0 ? (
				<View style={styles.actions}>
					<Pressable onPress={markAll} accessibilityRole="button" hitSlop={6}>
						<Txt style={styles.markAll}>Mark all read</Txt>
					</Pressable>
				</View>
			) : null}
			{notifications.map((item, index) => (
				<Row
					key={item.id}
					item={item}
					last={index === notifications.length - 1}
					onOpen={openRow}
					onDismiss={dismiss}
				/>
			))}
		</View>
	);
}

function Row({
	item,
	last,
	onOpen,
	onDismiss,
}: {
	item: Notification;
	last: boolean;
	onOpen: (item: Notification) => void;
	onDismiss: (item: Notification) => void;
}) {
	const unread = item.readState === 'unread';
	return (
		<View style={[styles.row, !last && styles.rowDivider, unread && styles.rowUnread]}>
			<Pressable
				style={styles.rowMain}
				onPress={() => onOpen(item)}
				accessibilityRole="button"
				accessibilityLabel={item.title}
			>
				<View style={styles.iconWrap}>
					<Feather name={iconFor(item.type)} size={15} color={colors.textSub} />
				</View>
				<View style={styles.rowText}>
					<Txt style={[styles.rowTitle, unread && styles.rowTitleUnread]} numberOfLines={1}>
						{item.title}
					</Txt>
					{item.body ? (
						<Txt style={styles.rowBody} numberOfLines={2}>
							{item.body}
						</Txt>
					) : null}
					<Txt style={styles.rowTime}>{timeAgo(item.createdAt)}</Txt>
				</View>
				{unread ? <View style={styles.unreadDot} /> : null}
			</Pressable>
			<Pressable
				style={styles.dismiss}
				onPress={() => onDismiss(item)}
				accessibilityRole="button"
				accessibilityLabel="Dismiss notification"
				hitSlop={8}
			>
				<Feather name="x" size={15} color={colors.textGhost} />
			</Pressable>
		</View>
	);
}

const styles = StyleSheet.create({
	center: {
		paddingVertical: 28,
	},
	error: {
		fontFamily: font.medium,
		fontSize: 12.5,
		color: colors.redInk,
		paddingVertical: 14,
	},
	empty: {
		alignItems: 'center',
		gap: 10,
		paddingVertical: 34,
	},
	emptyText: {
		fontFamily: font.medium,
		fontSize: 13,
		color: colors.textMuted,
	},
	actions: {
		flexDirection: 'row',
		justifyContent: 'flex-end',
		paddingBottom: 8,
	},
	markAll: {
		fontFamily: font.semibold,
		fontSize: 12.5,
		color: colors.brandPurple,
	},
	row: {
		flexDirection: 'row',
		alignItems: 'flex-start',
		gap: 4,
	},
	rowDivider: {
		borderBottomWidth: 1,
		borderBottomColor: colors.borderSoft,
	},
	rowUnread: {
		// A barely-there wash so unread rows read as a group without a heavy fill.
		backgroundColor: 'rgba(110,30,200,0.03)',
	},
	rowMain: {
		flex: 1,
		flexDirection: 'row',
		alignItems: 'flex-start',
		gap: 11,
		paddingVertical: 11,
		paddingLeft: 2,
	},
	iconWrap: {
		width: 30,
		height: 30,
		borderRadius: radii.pill,
		backgroundColor: colors.chipBg,
		alignItems: 'center',
		justifyContent: 'center',
		marginTop: 1,
	},
	rowText: {
		flex: 1,
		minWidth: 0,
		gap: 2,
	},
	rowTitle: {
		fontFamily: font.medium,
		fontSize: 13.5,
		color: colors.text,
	},
	rowTitleUnread: {
		fontFamily: font.semibold,
	},
	rowBody: {
		fontFamily: font.regular,
		fontSize: 12.5,
		color: colors.textSub,
		lineHeight: 17,
	},
	rowTime: {
		fontFamily: font.regular,
		fontSize: 11,
		color: colors.textGhost,
		marginTop: 1,
	},
	unreadDot: {
		width: 8,
		height: 8,
		borderRadius: 4,
		backgroundColor: colors.red,
		marginTop: 6,
	},
	dismiss: {
		width: 30,
		height: 30,
		alignItems: 'center',
		justifyContent: 'center',
		marginTop: 9,
	},
});

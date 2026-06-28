import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '@/src/auth/AuthContext';

/**
 * How often the unread badge re-checks the server. There's no realtime channel
 * (no websockets), so the bell polls. 60s keeps the count reasonably fresh
 * without much battery/network cost; the poll pauses while the app is
 * backgrounded and refetches the moment it returns to the foreground.
 */
const POLL_INTERVAL_MS = 60_000;

export interface NotificationsContextValue {
	/** Unread notifications for the signed-in user (0 when signed out). */
	unreadCount: number;
	/**
	 * Re-fetch the unread count now. Screens call this right after they mark
	 * notifications read / dismissed so the badge updates immediately rather than
	 * waiting for the next poll.
	 */
	refresh: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

/**
 * Owns the unread-count badge for the bell. Polls the API on an interval while
 * the app is active and exposes `refresh()` so a notification mutation elsewhere
 * can update the badge without waiting for the next tick.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
	const { client, session } = useAuth();
	const [unreadCount, setUnreadCount] = useState(0);
	// Re-create the poller only when the session identity changes (sign-in/out or
	// a staff company switch), not on every render.
	const sessionKey = session ? session.account.id : null;

	const refresh = useCallback(async () => {
		if (!session) {
			setUnreadCount(0);
			return;
		}
		try {
			setUnreadCount(await client.unreadNotificationCount(session.token));
		} catch {
			// A transient failure shouldn't wipe the badge — keep the last known count.
		}
	}, [client, session]);

	useEffect(() => {
		if (!sessionKey) {
			setUnreadCount(0);
			return;
		}
		let active = true;
		const tick = () => {
			if (active) {
				void refresh();
			}
		};
		tick(); // Prime the badge immediately on mount / session change.
		const interval = setInterval(() => {
			if (AppState.currentState === 'active') {
				tick();
			}
		}, POLL_INTERVAL_MS);
		// Refetch on foreground so the count is fresh the instant the user returns.
		const subscription = AppState.addEventListener('change', (state) => {
			if (state === 'active') {
				tick();
			}
		});
		return () => {
			active = false;
			clearInterval(interval);
			subscription.remove();
		};
	}, [sessionKey, refresh]);

	return (
		<NotificationsContext.Provider value={{ unreadCount, refresh }}>
			{children}
		</NotificationsContext.Provider>
	);
}

export function useNotifications(): NotificationsContextValue {
	const ctx = useContext(NotificationsContext);
	if (!ctx) {
		throw new Error('useNotifications must be used within a NotificationsProvider');
	}
	return ctx;
}

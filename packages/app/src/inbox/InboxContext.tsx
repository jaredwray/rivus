import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '@/src/auth/AuthContext';

/**
 * How often the Inbox badge re-checks the server. Like the notifications bell
 * there's no realtime channel, so it polls. 60s keeps the "needs you" count
 * reasonably fresh; the poll pauses while backgrounded and refetches on return.
 */
const POLL_INTERVAL_MS = 60_000;

export interface InboxContextValue {
	/** Conversations needing a human for the signed-in account (0 when signed out). */
	needsAttentionCount: number;
	/**
	 * Re-fetch the count now. The inbox screen calls this right after it sends a
	 * reply / approves a draft so the sidebar badge updates immediately rather than
	 * waiting for the next poll.
	 */
	refresh: () => Promise<void>;
}

const InboxContext = createContext<InboxContextValue | null>(null);

/**
 * Owns the "needs you" badge for the Inbox nav item. Polls the API on an interval
 * while the app is active and exposes `refresh()` so an inbox mutation can update
 * the badge without waiting for the next tick. Mirrors {@link NotificationsProvider}.
 */
export function InboxProvider({ children }: { children: ReactNode }) {
	const { client, session } = useAuth();
	const [needsAttentionCount, setNeedsAttentionCount] = useState(0);
	// Re-create the poller only when the session identity changes (sign-in/out or
	// a staff company switch), not on every render.
	const sessionKey = session ? session.account.id : null;

	const refresh = useCallback(
		async (isActive?: () => boolean) => {
			// `isActive` lets the poller below drop a result that resolves after the
			// provider unmounted (sign-out); external callers omit it (always active).
			const stillActive = () => !isActive || isActive();
			if (!session) {
				if (stillActive()) {
					setNeedsAttentionCount(0);
				}
				return;
			}
			try {
				const count = await client.needsAttentionCount(session.token);
				if (stillActive()) {
					setNeedsAttentionCount(count);
				}
			} catch {
				// A transient failure shouldn't wipe the badge — keep the last known count.
			}
		},
		[client, session],
	);

	useEffect(() => {
		if (!sessionKey) {
			setNeedsAttentionCount(0);
			return;
		}
		let active = true;
		const tick = () => {
			void refresh(() => active);
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
		<InboxContext.Provider value={{ needsAttentionCount, refresh }}>
			{children}
		</InboxContext.Provider>
	);
}

export function useInbox(): InboxContextValue {
	const ctx = useContext(InboxContext);
	if (!ctx) {
		throw new Error('useInbox must be used within an InboxProvider');
	}
	return ctx;
}

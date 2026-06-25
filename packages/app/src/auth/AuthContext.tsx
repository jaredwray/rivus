import type { LoginInput, UpdateAccountInput, VerifyCodeInput } from '@rivus/core';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import {
	type AuthResponse,
	type CodeSentResponse,
	createApiClient,
	type RivusApiClient,
	type SignupBody,
} from '@/src/api/client';
import { getApiBaseUrl } from '@/src/api/config';

/**
 * Web keeps the session in an HttpOnly cookie the API sets at sign-in, so the
 * client sends credentials and never holds the token in JS. Native has no cookie
 * jar, so it keeps using the bearer token returned in the response body.
 */
const IS_WEB = Platform.OS === 'web';

export interface AuthContextValue {
	/** The active session, or `null` when signed out. */
	session: AuthResponse | null;
	/**
	 * True while we're restoring a session on startup (web checks the cookie via
	 * `me()`). The gate shows a spinner until this clears so a valid session never
	 * flashes the sign-in screen.
	 */
	restoring: boolean;
	/** Shared API client (authed calls pass `session.token`; web ignores it and uses the cookie). */
	client: RivusApiClient;
	/** Request a sign-in code for an existing account. */
	signIn: (input: LoginInput) => Promise<CodeSentResponse>;
	/** Begin signup — emails a confirmation code. */
	signUp: (input: SignupBody) => Promise<CodeSentResponse>;
	/** Exchange a one-time code for a session. */
	verifyCode: (input: VerifyCodeInput) => Promise<void>;
	acceptInvite: (token: string) => Promise<void>;
	/** Update the account's business settings, keeping the session in sync (owner only). */
	updateAccount: (input: UpdateAccountInput) => Promise<void>;
	/** Cancel (soft-delete) the account, then sign out since it's now locked (owner only). */
	cancelAccount: () => Promise<void>;
	signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Holds the signed-in session and exposes the auth actions.
 *
 * On **web** the session survives reloads: the API sets an HttpOnly cookie at
 * sign-in, and on startup we ask `me()` who we are (the cookie rides along) before
 * deciding whether to show the dashboard. The token is never kept in JS — the
 * cookie is the credential. On **native** the session is still in-memory only
 * (persisting it in SecureStore is a follow-up), so a cold start returns to the
 * sign-in screen.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
	const client = useMemo(
		() => createApiClient(getApiBaseUrl(), undefined, { withCredentials: IS_WEB }),
		[],
	);
	const [session, setSession] = useState<AuthResponse | null>(null);
	// Only web has a cookie to restore; native starts signed out with nothing to check.
	const [restoring, setRestoring] = useState(IS_WEB);

	useEffect(() => {
		if (!IS_WEB) {
			return;
		}
		let active = true;
		client
			.me()
			.then((me) => {
				if (active) {
					// No token on web — the cookie authenticates subsequent calls.
					setSession({ token: '', ...me });
				}
			})
			.catch(() => {
				// No cookie, or it expired / was revoked: stay signed out.
			})
			.finally(() => {
				if (active) {
					setRestoring(false);
				}
			});
		return () => {
			active = false;
		};
	}, [client]);

	const value = useMemo<AuthContextValue>(() => {
		// On web the token must never be retained in JS; the cookie is the credential.
		const adopt = (res: AuthResponse): AuthResponse => (IS_WEB ? { ...res, token: '' } : res);
		// JS can't clear an HttpOnly cookie, so ask the API to expire it on sign-out.
		const clearCookie = () => {
			if (IS_WEB) {
				void client.logout().catch(() => {});
			}
		};
		return {
			session,
			restoring,
			client,
			signIn(input) {
				return client.login(input);
			},
			signUp(input) {
				return client.signup(input);
			},
			async verifyCode(input) {
				setSession(adopt(await client.verifyCode(input)));
			},
			async acceptInvite(token) {
				setSession(adopt(await client.acceptInvite({ token })));
			},
			async updateAccount(input) {
				if (!session) {
					return;
				}
				const account = await client.updateAccount(session.token, input);
				setSession({ ...session, account });
			},
			async cancelAccount() {
				if (!session) {
					return;
				}
				await client.cancelAccount(session.token);
				// The account is now canceled, so every authed call would 401 — drop the session.
				setSession(null);
				clearCookie();
			},
			signOut() {
				setSession(null);
				clearCookie();
			},
		};
	}, [client, session, restoring]);

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
	const ctx = useContext(AuthContext);
	if (!ctx) {
		throw new Error('useAuth must be used within an AuthProvider');
	}
	return ctx;
}

/** Human-readable label for a role. */
export function roleLabel(role: AuthResponse['role']): string {
	switch (role) {
		case 'owner':
			return 'Owner';
		case 'manager':
			return 'Manager';
		default:
			return 'Member';
	}
}

/** Up-to-two-letter initials from a name, for avatars. */
export function initialsOf(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) {
		return '?';
	}
	const first = parts[0]?.[0] ?? '';
	const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
	return (first + last).toUpperCase();
}

import type { LoginInput, UpdateAccountInput, VerifyCodeInput } from '@rivus/core';
import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';
import {
	type AuthResponse,
	type CodeSentResponse,
	createApiClient,
	type RivusApiClient,
	type SignupBody,
} from '@/src/api/client';
import { getApiBaseUrl } from '@/src/api/config';

export interface AuthContextValue {
	/** The active session, or `null` when signed out. */
	session: AuthResponse | null;
	/** Shared API client (screens use `session.token` for authed calls). */
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
 * Holds the signed-in session in memory and exposes the auth actions. The
 * session is intentionally not persisted yet — a reload returns to the sign-in
 * screen (wiring SecureStore/AsyncStorage is a follow-up).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
	const client = useMemo(() => createApiClient(getApiBaseUrl()), []);
	const [session, setSession] = useState<AuthResponse | null>(null);

	const value = useMemo<AuthContextValue>(
		() => ({
			session,
			client,
			signIn(input) {
				return client.login(input);
			},
			signUp(input) {
				return client.signup(input);
			},
			async verifyCode(input) {
				setSession(await client.verifyCode(input));
			},
			async acceptInvite(token) {
				setSession(await client.acceptInvite({ token }));
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
			},
			signOut() {
				setSession(null);
			},
		}),
		[client, session],
	);

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

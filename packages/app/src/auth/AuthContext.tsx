import type { LoginInput } from '@rivus/core';
import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';
import {
	type AuthResponse,
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
	signIn: (input: LoginInput) => Promise<void>;
	signUp: (input: SignupBody) => Promise<void>;
	acceptInvite: (token: string, password: string) => Promise<void>;
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
			async signIn(input) {
				setSession(await client.login(input));
			},
			async signUp(input) {
				setSession(await client.signup(input));
			},
			async acceptInvite(token, password) {
				setSession(await client.acceptInvite({ token, password }));
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
			return 'Team Member';
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

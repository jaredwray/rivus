import { useLocalSearchParams } from 'expo-router';
import { AuthScreen } from '@/src/auth/AuthScreen';

/**
 * Landing screen for the link in an invitation email
 * (`<APP_URL>/accept-invite?token=…`). It opens the "join a team" form with the
 * invite code pre-filled so the invitee only has to confirm to join.
 */
export default function AcceptInviteScreen() {
	const { token } = useLocalSearchParams();
	const inviteToken = Array.isArray(token) ? (token[0] ?? '') : (token ?? '');
	// `AuthScreen` seeds its state from `initialInviteToken` once (via useState), so
	// key on the token to remount — and pick up the new code — if the link changes.
	return <AuthScreen key={inviteToken} initialMode="invite" initialInviteToken={inviteToken} />;
}

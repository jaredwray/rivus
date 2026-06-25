import { AuthScreen } from '@/src/auth/AuthScreen';

/** "Create your business" account flow, on its own URL. */
export default function SignupScreen() {
	return <AuthScreen initialMode="signup" />;
}

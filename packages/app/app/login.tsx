import { AuthScreen } from '@/src/auth/AuthScreen';

/** Sign-in screen. The root path also lands here for signed-out visitors. */
export default function LoginScreen() {
	return <AuthScreen initialMode="signin" />;
}

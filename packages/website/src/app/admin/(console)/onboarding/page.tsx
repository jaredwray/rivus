import type { Metadata } from 'next';
import { OnboardingScreen } from '../../../../components/admin/onboarding-screen';

export const metadata: Metadata = {
	title: 'Onboarding — Rivus Console',
};

export default function AdminOnboardingPage() {
	return <OnboardingScreen />;
}

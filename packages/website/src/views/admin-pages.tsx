import { AccountsScreen } from '../components/admin/accounts-screen';
import { ConsoleLayout } from '../components/admin/console-layout';
import { EscalationsScreen } from '../components/admin/escalations-screen';
import { OnboardingScreen } from '../components/admin/onboarding-screen';
import { Overview } from '../components/admin/overview';

export function AdminOverviewPage() {
	return (
		<ConsoleLayout pathname="/admin">
			<Overview />
		</ConsoleLayout>
	);
}

export function AdminAccountsPage() {
	return (
		<ConsoleLayout pathname="/admin/accounts">
			<AccountsScreen />
		</ConsoleLayout>
	);
}

export function AdminOnboardingPage() {
	return (
		<ConsoleLayout pathname="/admin/onboarding">
			<OnboardingScreen />
		</ConsoleLayout>
	);
}

export function AdminEscalationsPage() {
	return (
		<ConsoleLayout pathname="/admin/escalations">
			<EscalationsScreen />
		</ConsoleLayout>
	);
}

import type { Metadata } from 'next';
import { AccountsScreen } from '../../../../components/admin/accounts-screen';

export const metadata: Metadata = {
	title: 'Accounts — Rivus Console',
};

export default function AdminAccountsPage() {
	return <AccountsScreen />;
}

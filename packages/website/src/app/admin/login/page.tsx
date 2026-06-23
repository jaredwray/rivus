import type { Metadata } from 'next';
import { AdminLogin } from '../../../components/admin/admin-login';
import '../admin.css';

export const metadata: Metadata = {
	title: 'Sign in — Rivus Console',
	robots: { index: false, follow: false },
};

export default function AdminLoginPage() {
	return <AdminLogin />;
}

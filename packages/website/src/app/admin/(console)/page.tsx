import type { Metadata } from 'next';
import { Overview } from '../../../components/admin/overview';

export const metadata: Metadata = {
	title: 'Overview — Rivus Console',
};

export default function AdminOverviewPage() {
	return <Overview />;
}

import type { Metadata } from 'next';
import { EscalationsScreen } from '../../../../components/admin/escalations-screen';

export const metadata: Metadata = {
	title: 'Escalations — Rivus Console',
};

export default function AdminEscalationsPage() {
	return <EscalationsScreen />;
}

import type { Metadata } from 'next';
import { LegalPage } from '../../components/marketing/legal-page';
import { securityDoc } from '../../lib/legal';

export const metadata: Metadata = {
	title: 'Security — Rivus',
	description: 'How Rivus keeps your data, conversations, and customers safe.',
	alternates: { canonical: '/security' },
};

export default function SecurityPage() {
	return <LegalPage doc={securityDoc} />;
}

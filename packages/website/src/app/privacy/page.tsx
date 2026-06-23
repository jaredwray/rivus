import type { Metadata } from 'next';
import { LegalPage } from '../../components/marketing/legal-page';
import { privacyDoc } from '../../lib/legal';

export const metadata: Metadata = {
	title: 'Privacy Policy — Rivus',
	description: 'How Rivus collects, uses, shares, and protects your information.',
};

export default function PrivacyPage() {
	return <LegalPage doc={privacyDoc} />;
}

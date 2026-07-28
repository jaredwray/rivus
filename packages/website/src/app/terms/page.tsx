import type { Metadata } from 'next';
import { LegalPage } from '../../components/marketing/legal-page';
import { termsDoc } from '../../lib/legal';

export const metadata: Metadata = {
	title: 'Terms of Service — Rivus',
	description: 'The terms for using Rivus and the Rivus AI agent.',
	alternates: { canonical: '/terms' },
};

export default function TermsPage() {
	return <LegalPage doc={termsDoc} />;
}

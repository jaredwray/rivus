import type { Metadata } from 'next';
import { LegalPage } from '../../components/marketing/legal-page';
import { acceptableUseDoc } from '../../lib/legal';

export const metadata: Metadata = {
	title: 'Acceptable Use Policy — Rivus',
	description:
		'The rules for messaging through Rivus: consent requirements, carrier-prohibited content, and how we enforce them.',
	alternates: { canonical: '/acceptable-use' },
};

export default function AcceptableUsePage() {
	return <LegalPage doc={acceptableUseDoc} />;
}

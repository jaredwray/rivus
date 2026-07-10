import type { Metadata } from 'next';
import { LegalPage } from '../../components/marketing/legal-page';
import { smsOptInDoc } from '../../lib/legal';

export const metadata: Metadata = {
	title: 'SMS opt-in — Rivus',
	description:
		'How people opt in to text messages sent through Rivus, the exact consent they give, and how to opt out at any time.',
};

export default function SmsOptInPage() {
	return <LegalPage doc={smsOptInDoc} />;
}

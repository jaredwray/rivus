import type { Metadata } from 'next';
import { LegalPage } from '../../components/marketing/legal-page';
import { smsTermsDoc } from '../../lib/legal';

export const metadata: Metadata = {
	title: 'SMS Messaging Terms — Rivus',
	description:
		'The terms for text messages sent through Rivus: program description, message frequency, rates, and how to opt out (STOP) or get help (HELP).',
};

export default function SmsTermsPage() {
	return <LegalPage doc={smsTermsDoc} />;
}

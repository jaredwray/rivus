import type { Metadata } from 'next';
import { ComingSoon } from '../../components/marketing/coming-soon';

export const metadata: Metadata = {
	title: 'Careers — Rivus',
	description: 'Help build Rivus for the businesses that keep our towns running.',
};

export default function CareersPage() {
	return (
		<ComingSoon
			eyebrow="Careers"
			title="Work at Rivus"
			blurb="We're a small team building Rivus for the local businesses that keep our towns running. Open roles are posted here soon — check back shortly."
			email="careers@rivus.ai"
		/>
	);
}

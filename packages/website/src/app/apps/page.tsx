import type { Metadata } from 'next';
import { ComingSoon } from '../../components/marketing/coming-soon';

export const metadata: Metadata = {
	title: 'Mobile apps — Rivus',
	description: 'The Rivus apps for iPhone and Android are on the way.',
};

export default function AppsPage() {
	return (
		<ComingSoon
			eyebrow="Coming soon"
			title="Rivus on every device"
			blurb="Native apps for iPhone and Android are in the works, so you can run your front office from anywhere. Until then, Rivus runs great in any browser."
		/>
	);
}

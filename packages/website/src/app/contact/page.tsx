import type { Metadata } from 'next';
import { ComingSoon } from '../../components/marketing/coming-soon';

export const metadata: Metadata = {
	title: 'Contact — Rivus',
	description: 'Get in touch with the Rivus team.',
};

export default function ContactPage() {
	return (
		<ComingSoon
			eyebrow="Contact"
			title="Get in touch"
			blurb="A full contact center is on the way. In the meantime, we'd still love to hear from you."
			email="hello@rivus.ai"
		/>
	);
}

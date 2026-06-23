import type { Metadata } from 'next';
import { ComingSoon } from '../../components/marketing/coming-soon';

export const metadata: Metadata = {
	title: 'About — Rivus',
	description: 'The team building the AI agent that runs the front office for local business.',
};

export default function AboutPage() {
	return (
		<ComingSoon
			eyebrow="Company"
			title="About Rivus"
			blurb="We're building the AI agent that runs the front office for local businesses, so owners can get back to the work they love. More about our story and team is coming soon."
		/>
	);
}

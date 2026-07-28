import type { Metadata } from 'next';
import { DemoRequest } from '../../components/marketing/demo-request';
import { PageHero } from '../../components/marketing/page-hero';
import { SiteFooter } from '../../components/marketing/site-footer';
import { SiteNav } from '../../components/marketing/site-nav';

export const metadata: Metadata = {
	title: 'Book a demo — Rivus',
	description:
		'See Rivus answer calls, book jobs, and run a front office live. Request a demo and a specialist will reach out within one business day.',
};

export default function DemoPage() {
	return (
		<>
			<SiteNav />
			<main id="main">
				<PageHero
					eyebrow="BOOK A DEMO"
					title="Watch Rivus answer for a business like yours."
					lead="Thirty minutes, live: Rivus picks up a call, books the job, sends the invoice, and asks for the review — with your questions answered by a human the whole way."
				/>
				<section className="join">
					<div className="join__container">
						<DemoRequest />
					</div>
				</section>
			</main>
			<SiteFooter />
		</>
	);
}

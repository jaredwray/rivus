import { DemoRequest } from '../components/marketing/demo-request';
import { PageHero } from '../components/marketing/page-hero';
import { SiteFooter } from '../components/marketing/site-footer';
import { SiteNav } from '../components/marketing/site-nav';

export function DemoPage() {
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

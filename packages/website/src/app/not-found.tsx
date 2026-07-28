import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter } from '../components/marketing/site-footer';
import { SiteNav } from '../components/marketing/site-nav';

export const metadata: Metadata = {
	title: 'Page not found — Rivus',
};

export default function NotFound() {
	return (
		<>
			<SiteNav />
			<main id="main">
				<section className="join">
					<div className="join__container">
						<div className="join-card join-card--center">
							<p className="eyebrow">404</p>
							<h1 className="join-card__title">This page is off the schedule.</h1>
							<p className="join-card__lead">
								The link may be out of date, or the address may have a typo. Rivus never leaves a
								caller hanging, and we won't leave you hanging either — here's where to go next.
							</p>
							<div className="page-hero__actions">
								<Link className="btn btn--primary" href="/">
									Back to the home page
								</Link>
								<Link className="btn btn--outline" href="/contact">
									Contact us
								</Link>
							</div>
						</div>
					</div>
				</section>
			</main>
			<SiteFooter />
		</>
	);
}

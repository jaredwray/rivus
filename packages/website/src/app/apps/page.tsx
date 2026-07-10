import type { Metadata } from 'next';
import { ArrowRightIcon, CheckIcon, Icon } from '../../components/marketing/icons';
import { PageHero } from '../../components/marketing/page-hero';
import { SiteFooter } from '../../components/marketing/site-footer';
import { SiteNav } from '../../components/marketing/site-nav';
import { appHighlights, appPlatforms } from '../../lib/company';
import { appUrl } from '../../lib/site';

export const metadata: Metadata = {
	title: 'Mobile apps — Rivus',
	description:
		'Run your front office from anywhere. Rivus is live on the web today, with native iPhone and Android apps on the way.',
};

export default function AppsPage() {
	return (
		<>
			<SiteNav />
			<main id="main">
				<PageHero
					eyebrow="APPS"
					title="Rivus, wherever the day takes you."
					lead="The web app runs your whole front office today, and native iPhone and Android apps are on the way — all fully in sync, from the shop to the truck to the couch."
					actions={
						<a className="btn btn--primary btn--lg" href={appUrl}>
							Open the web app
							<ArrowRightIcon size={18} />
						</a>
					}
				/>

				<section className="section section--plain">
					<div className="container">
						<div className="section-head">
							<p className="eyebrow">EVERY PLATFORM</p>
							<h2 className="h2">One front office, three screens.</h2>
						</div>
						<div className="grid-3">
							{appPlatforms.map((platform) => (
								<article key={platform.name} className="card">
									<div className="card__head">
										<div className="tile tile--lg tile--violet">
											<Icon name={platform.icon} size={22} />
										</div>
										<span className={`chip chip--${platform.status}`}>{platform.statusLabel}</span>
									</div>
									<h3 className="card__title">{platform.name}</h3>
									<p className="card__body">{platform.description}</p>
									{platform.status === 'live' ? (
										<a className="card__link" href={appUrl}>
											Open the web app
											<ArrowRightIcon size={15} />
										</a>
									) : null}
								</article>
							))}
						</div>
					</div>
				</section>

				<section className="section section--gray">
					<div className="container">
						<div className="section-head">
							<p className="eyebrow">BUILT FOR THE FIELD</p>
							<h2 className="h2">Your day, at a glance.</h2>
							<p className="lead">
								The apps aren't a second inbox to manage — they're a window onto everything Rivus
								has already handled, and a fast yes/no on the few things that need you.
							</p>
						</div>
						<div className="prose">
							<ul className="feature-row__points">
								{appHighlights.map((highlight) => (
									<li key={highlight}>
										<CheckIcon size={19} />
										{highlight}
									</li>
								))}
							</ul>
						</div>
					</div>
				</section>
			</main>
			<SiteFooter />
		</>
	);
}

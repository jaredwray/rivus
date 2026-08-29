import { FinalCta } from '../components/marketing/final-cta';
import { Icon } from '../components/marketing/icons';
import { PageHero } from '../components/marketing/page-hero';
import { SiteFooter } from '../components/marketing/site-footer';
import { SiteNav } from '../components/marketing/site-nav';
import { aboutStory, companyStats, companyValues } from '../lib/company';

export function AboutPage() {
	return (
		<>
			<SiteNav />
			<main id="main">
				<PageHero
					eyebrow="ABOUT RIVUS"
					title="Local business keeps the lights on. We keep the phones answered."
					lead="Rivus is the AI agent that runs the front office for the trades, salons, clinics, and crews that keep our towns running — so the people behind them can get back to the work they love."
				>
					<div className="stat-band">
						{companyStats.map((stat) => (
							<div key={stat.label} className="stat-band__stat">
								<div className="stat-band__value">{stat.value}</div>
								<div className="stat-band__label">{stat.label}</div>
							</div>
						))}
					</div>
				</PageHero>

				<section className="section section--plain">
					<div className="container">
						<div className="section-head">
							<p className="eyebrow">OUR STORY</p>
							<h2 className="h2">Built for the call you couldn't take.</h2>
						</div>
						<div className="prose">
							{aboutStory.map((paragraph) => (
								<p key={paragraph}>{paragraph}</p>
							))}
						</div>
					</div>
				</section>

				<section className="section section--gray">
					<div className="container">
						<div className="section-head">
							<p className="eyebrow">WHAT WE BELIEVE</p>
							<h2 className="h2">The principles behind the product.</h2>
						</div>
						<div className="grid-4">
							{companyValues.map((value) => (
								<article key={value.title} className="card">
									<div className={`tile tile--lg tile--${value.tint}`}>
										<Icon name={value.icon} size={22} />
									</div>
									<h3 className="card__title">{value.title}</h3>
									<p className="card__body">{value.description}</p>
								</article>
							))}
						</div>
					</div>
				</section>

				<FinalCta />
			</main>
			<SiteFooter />
		</>
	);
}

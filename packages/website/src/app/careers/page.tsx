import type { Metadata } from 'next';
import { ArrowRightIcon, Icon } from '../../components/marketing/icons';
import { PageHero } from '../../components/marketing/page-hero';
import { SiteFooter } from '../../components/marketing/site-footer';
import { SiteNav } from '../../components/marketing/site-nav';
import { careersEmail, careersValues } from '../../lib/company';

export const metadata: Metadata = {
	title: 'Careers — Rivus',
	description:
		'Help build the AI agent that runs the front office for the local businesses that keep our towns running.',
};

export default function CareersPage() {
	return (
		<>
			<SiteNav />
			<main id="main">
				<PageHero
					eyebrow="CAREERS"
					title="Do your best work for the people who fix everything else."
					lead="We're a small team building the AI front office for plumbers, stylists, clinics, and crews. Every feature you ship hands a business owner their evening back."
					actions={
						<a className="btn btn--primary btn--lg" href={`mailto:${careersEmail}`}>
							Introduce yourself
							<ArrowRightIcon size={18} />
						</a>
					}
				/>

				<section className="section section--plain">
					<div className="container">
						<div className="section-head">
							<p className="eyebrow">HOW WE WORK</p>
							<h2 className="h2">A small team with a big backyard.</h2>
						</div>
						<div className="grid-4">
							{careersValues.map((value) => (
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

				<section className="section section--gray">
					<div className="container">
						<div className="section-head">
							<p className="eyebrow">OPEN ROLES</p>
							<h2 className="h2">Nothing posted right now.</h2>
						</div>
						<div className="roles-empty">
							<h3 className="roles-empty__title">But great people make their own openings.</h3>
							<p className="roles-empty__body">
								If Rivus sounds like the problem you want to spend your days on, don't wait for a
								listing. Tell us what you'd build first — we read every note.
							</p>
							<a className="btn btn--primary" href={`mailto:${careersEmail}`}>
								Email {careersEmail}
							</a>
						</div>
					</div>
				</section>
			</main>
			<SiteFooter />
		</>
	);
}

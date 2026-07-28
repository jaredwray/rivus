import { foundingBenefits, signupUrl } from '../../lib/site';
import { ArrowRightIcon, Icon } from './icons';

/**
 * The founding-customers section — the honest replacement for pre-launch
 * testimonials. Swapped for real customer stories once real customers agree
 * to tell them (WEBSITE_CONTENT_PLAN.md, Phase 4).
 */
export function FoundingCustomers() {
	return (
		<section className="section section--gray">
			<div className="container">
				<div className="section-head">
					<p className="eyebrow">FOUNDING CUSTOMERS</p>
					<h2 className="h2">Be one of the first owners on Rivus.</h2>
					<p className="lead">
						Rivus is new, and we're building it shoulder to shoulder with the first businesses on
						it. Here's what founding customers get — no invented five-star quotes required.
					</p>
				</div>
				<div className="grid-3">
					{foundingBenefits.map((benefit) => (
						<article key={benefit.title} className="card">
							<div className={`tile tile--lg tile--${benefit.tint}`}>
								<Icon name={benefit.icon} size={22} />
							</div>
							<h3 className="card__title">{benefit.title}</h3>
							<p className="card__body">{benefit.description}</p>
						</article>
					))}
				</div>
				<div className="page-hero__actions">
					<a className="btn btn--primary btn--lg" href={signupUrl}>
						Claim a founding spot
						<ArrowRightIcon size={18} />
					</a>
				</div>
			</div>
		</section>
	);
}

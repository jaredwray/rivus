import Link from 'next/link';
import { homeFaqTeasers } from '../../lib/faq';
import { pricingTiers, signupUrl } from '../../lib/site';
import { ArrowRightIcon, CheckIcon } from './icons';

export function Pricing() {
	return (
		<section id="pricing" className="section section--plain section--edge">
			<div className="container">
				<div className="section-head" style={{ marginBottom: 18 }}>
					<p className="eyebrow">SIMPLE PRICING</p>
					<h2 className="h2">One flat price. No per-call fees.</h2>
				</div>
				<div className="price-note">
					<CheckIcon size={17} />
					Every feature on every plan — plus a free onboarding specialist
				</div>
				<div className="price-grid">
					{pricingTiers.map((tier) => (
						<div key={tier.name} className={tier.featured ? 'plan plan--featured' : 'plan'}>
							{tier.badge ? <div className="plan__badge">{tier.badge}</div> : null}
							<h3 className="plan__name">{tier.name}</h3>
							<div className="plan__audience">{tier.audience}</div>
							<div className="plan__price">
								<span className={tier.period ? 'plan__amount' : 'plan__amount plan__amount--sm'}>
									{tier.price}
								</span>
								{tier.period ? <span className="plan__period">{tier.period}</span> : null}
							</div>
							{tier.priceNote ? <div className="plan__price-note">{tier.priceNote}</div> : null}
							<a
								className={tier.featured ? 'btn btn--primary plan__cta' : 'btn btn--soft plan__cta'}
								href={tier.ctaHref ?? signupUrl}
							>
								{tier.cta}
							</a>
							<ul className="plan__features">
								{[...tier.capacity, ...tier.features].map((feature) => (
									<li key={feature}>
										<CheckIcon size={18} />
										{feature}
									</li>
								))}
							</ul>
						</div>
					))}
				</div>

				{/* Cost, number porting, and human-handoff — the questions that stall
				    a signup — answered inline; the rest live on /faq. */}
				<div className="price-faq">
					<p className="eyebrow price-faq__eyebrow">OWNERS ASK</p>
					<div className="faq-list">
						{homeFaqTeasers.map((entry) => (
							<details key={entry.question} className="faq-item">
								<summary className="faq-item__q">{entry.question}</summary>
								<p className="faq-item__a">{entry.answer}</p>
							</details>
						))}
					</div>
					<p className="price-faq__more">
						<Link className="card__link" href="/faq">
							More questions answered in the FAQ
							<ArrowRightIcon size={15} />
						</Link>
						<Link className="card__link" href="/compare">
							Compare with an answering service
							<ArrowRightIcon size={15} />
						</Link>
					</p>
				</div>
			</div>
		</section>
	);
}

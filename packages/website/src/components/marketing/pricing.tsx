import { pricingTiers, signupUrl } from '../../lib/site';
import { CheckIcon } from './icons';

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
							<div className="plan__name">{tier.name}</div>
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
								{tier.features.map((feature) => (
									<li key={feature}>
										<CheckIcon size={18} />
										{feature}
									</li>
								))}
							</ul>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

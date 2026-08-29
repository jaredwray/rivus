import { ConversationMock } from '../components/marketing/conversation-mock';
import { FinalCta } from '../components/marketing/final-cta';
import { ArrowRightIcon, CheckIcon, Icon, InboxIcon } from '../components/marketing/icons';
import { Link } from '../components/marketing/link';
import { PageHero } from '../components/marketing/page-hero';
import { SiteFooter } from '../components/marketing/site-footer';
import { SiteNav } from '../components/marketing/site-nav';
import { findIndustry, type Industry } from '../lib/industries';
import { signupUrl } from '../lib/site';

export function requireIndustry(slug: string): Industry {
	const industry = findIndustry(slug);
	if (!industry) {
		throw new Error('Industry not found');
	}
	return industry;
}

export function IndustryPage({ industry }: { industry: Industry }) {
	return (
		<>
			<SiteNav />
			<main id="main">
				<PageHero
					eyebrow={`RIVUS FOR ${industry.name.toUpperCase()}`}
					title={industry.title}
					lead={industry.lead}
					actions={
						<>
							<a className="btn btn--primary btn--lg" href={signupUrl}>
								Get started free
								<ArrowRightIcon size={18} />
							</a>
							<Link className="btn btn--outline btn--lg" href="/#pricing">
								See pricing
							</Link>
						</>
					}
				/>

				<section className="section section--gray">
					<div className="container">
						<div className="section-head">
							<p className="eyebrow">SOUND FAMILIAR?</p>
							<h2 className="h2">The calls you lose while you're working.</h2>
						</div>
						<div className="grid-3">
							{industry.pains.map((pain) => (
								<article key={pain.title} className="card">
									<div className={`tile tile--lg tile--${pain.tint}`}>
										<Icon name={pain.icon} size={22} />
									</div>
									<h3 className="card__title">{pain.title}</h3>
									<p className="card__body">{pain.description}</p>
								</article>
							))}
						</div>
					</div>
				</section>

				<section className="section section--plain">
					<div className="container">
						<div className="feature-row">
							<div className="feature-row__copy">
								<span className="tag">
									<InboxIcon size={16} />
									How Rivus answers
								</span>
								<h3 className="feature-row__title">Your front office, handled for you.</h3>
								<p className="feature-row__lead">
									Rivus picks up every conversation the moment it starts and carries it all the way
									to a booked, paid job — trained on your services, your prices, and your voice.
								</p>
								<ul className="feature-row__points">
									{industry.handles.map((item) => (
										<li key={item}>
											<CheckIcon size={19} />
											{item}
										</li>
									))}
								</ul>
							</div>
							<div className="feature-row__visual">
								<ConversationMock conversation={industry.conversation} />
							</div>
						</div>
					</div>
				</section>

				<FinalCta />
			</main>
			<SiteFooter />
		</>
	);
}

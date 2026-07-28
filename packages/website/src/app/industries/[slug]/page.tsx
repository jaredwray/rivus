import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConversationMock } from '../../../components/marketing/conversation-mock';
import { FinalCta } from '../../../components/marketing/final-cta';
import { ArrowRightIcon, CheckIcon, Icon, InboxIcon } from '../../../components/marketing/icons';
import { PageHero } from '../../../components/marketing/page-hero';
import { SiteFooter } from '../../../components/marketing/site-footer';
import { SiteNav } from '../../../components/marketing/site-nav';
import { findIndustry, industries } from '../../../lib/industries';
import { signupUrl } from '../../../lib/site';

interface IndustryPageProps {
	params: Promise<{ slug: string }>;
}

/** Every trade page is statically generated from the industries data. */
export function generateStaticParams(): { slug: string }[] {
	return industries.map((industry) => ({ slug: industry.slug }));
}

export async function generateMetadata({ params }: IndustryPageProps): Promise<Metadata> {
	const industry = findIndustry((await params).slug);
	if (!industry) {
		return { title: 'Page not found — Rivus' };
	}
	return {
		title: `Rivus for ${industry.name} — the AI agent that runs your front office`,
		description: industry.metaDescription,
		alternates: { canonical: `/industries/${industry.slug}` },
	};
}

export default async function IndustryPage({ params }: IndustryPageProps) {
	const industry = findIndustry((await params).slug);
	if (!industry) {
		notFound();
	}

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

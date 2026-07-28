import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRightIcon, Icon, PinIcon } from '../../components/marketing/icons';
import { PageHero } from '../../components/marketing/page-hero';
import { SiteFooter } from '../../components/marketing/site-footer';
import { SiteNav } from '../../components/marketing/site-nav';
import { contactChannels } from '../../lib/company';

export const metadata: Metadata = {
	title: 'Contact — Rivus',
	description:
		'Talk to the Rivus team — sales, support, press, privacy, and security. We reply within one business day.',
	alternates: { canonical: '/contact' },
};

export default function ContactPage() {
	return (
		<>
			<SiteNav />
			<main id="main">
				<PageHero
					eyebrow="CONTACT"
					title="Talk to a human."
					lead="We build software that answers in seconds, so we hold ourselves to the same bar — write to any address below and a real person replies within one business day."
					actions={
						<>
							<Link className="btn btn--primary btn--lg" href="/demo">
								Book a demo
								<ArrowRightIcon size={18} />
							</Link>
							<a className="btn btn--outline btn--lg" href="mailto:hello@rivus.ai">
								Email hello@rivus.ai
							</a>
						</>
					}
				/>

				<section className="section section--plain">
					<div className="container">
						<div className="section-head">
							<p className="eyebrow">THE RIGHT DOOR</p>
							<h2 className="h2">Reach the team that can help.</h2>
						</div>
						<div className="grid-3">
							{contactChannels.map((channel) => (
								<article key={channel.title} className="card">
									<div className={`tile tile--lg tile--${channel.tint}`}>
										<Icon name={channel.icon} size={22} />
									</div>
									<h3 className="card__title">{channel.title}</h3>
									<p className="card__body">{channel.description}</p>
									<a className="card__link" href={`mailto:${channel.email}`}>
										{channel.email}
										<ArrowRightIcon size={15} />
									</a>
									{channel.page ? (
										<Link className="card__link" href={channel.page.href}>
											{channel.page.label}
											<ArrowRightIcon size={15} />
										</Link>
									) : null}
								</article>
							))}
							<article className="card">
								<div className="tile tile--lg tile--red">
									<PinIcon size={22} />
								</div>
								<h3 className="card__title">Headquarters</h3>
								<p className="card__body">
									Rivus is built by a remote-first team with roots in Seattle, Washington, United
									States — find us at rivus.ai and riv.us.
								</p>
							</article>
						</div>
					</div>
				</section>
			</main>
			<SiteFooter />
		</>
	);
}

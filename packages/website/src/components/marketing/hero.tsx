import Link from 'next/link';
import { Fragment } from 'react';
import { industries } from '../../lib/industries';
import { signupUrl, siteConfig } from '../../lib/site';
import { BrandImg } from './brand-img';
import { ArrowRightIcon, BoltIcon, CheckIcon, PlayIcon } from './icons';

export function Hero() {
	return (
		<header className="hero">
			<div className="hero__glow-a" aria-hidden="true" />
			<div className="hero__glow-b" aria-hidden="true" />
			<div className="hero__inner">
				<div className="hero__copy">
					<div className="badge">
						<span className="badge__chip">FREE SETUP</span>
						<span className="badge__text">We onboard you ourselves — at no cost</span>
					</div>
					<h1 className="hero__title">
						Never miss another <span className="grad-text">call.</span>
					</h1>
					<p className="hero__lead">{siteConfig.heroLead}</p>
					<div className="hero__actions">
						<a className="btn btn--primary btn--lg" href={signupUrl}>
							Get started free
							<ArrowRightIcon size={18} />
						</a>
						<a className="btn btn--outline btn--lg" href="#how">
							<span className="hero__play">
								<PlayIcon size={12} />
							</span>
							See how it works
						</a>
					</div>
					<p className="hero__reassure">
						<CheckIcon size={17} />
						<span>A specialist sets it up for you, free · No credit card required</span>
					</p>
				</div>

				<div className="hero__device">
					<div className="hero__phone">
						<div className="hero__screen">
							<div className="hero__notch" aria-hidden="true" />
							<div className="convo__header">
								<div className="avatar">DW</div>
								<div>
									<div className="convo__name">Dana Whitfield</div>
									<div className="convo__status">
										<span className="dot" />
										Text · Rivus handling
									</div>
								</div>
							</div>
							<div className="convo__thread">
								<div className="bubble bubble--in">
									Hey, my water heater's leaking — can someone come today?
								</div>
								<div className="bubble--row">
									<div className="bubble--out">
										I can get a tech out today. I've got <b>2:00</b> or <b>4:30</b> open — which
										works?
									</div>
									<span className="bubble__mark">
										<BrandImg className="mark-img" src="/assets/rivus-symbol-white.svg" alt="" />
									</span>
								</div>
								<div className="convo__meta">
									<BoltIcon size={11} />
									<span>Rivus answered in seconds</span>
								</div>
								<div className="bubble bubble--in">2pm works, thank you!</div>
								<div className="booked">
									<div className="booked__icon">
										<CheckIcon size={19} />
									</div>
									<div className="inbox__meta">
										<div className="booked__title">New job booked</div>
										<div className="booked__sub">Water heater repair · 2:00 PM today</div>
									</div>
									<span className="booked__amt">On calendar</span>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>

			<div className="trust">
				<div className="trust__inner">
					{/* No invented ratings: until real review numbers exist, the honest
					    line is the founding-customer offer (see the claims rules in
					    WEBSITE_CONTENT_PLAN.md). */}
					<div className="trust__for">
						Now onboarding <b>founding customers</b> — free human setup
					</div>
					<span className="trust__sep" />
					<div className="trust__for">
						Built for{' '}
						{industries.map((industry, index) => (
							<Fragment key={industry.slug}>
								{index > 0 ? ' · ' : null}
								<Link className="trust__link" href={`/industries/${industry.slug}`}>
									{industry.shortName}
								</Link>
							</Fragment>
						))}
					</div>
				</div>
			</div>
		</header>
	);
}

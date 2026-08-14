import { onboardingChecklist, onboardingStats, signupUrl } from '../../lib/site';
import { ArrowRightIcon, CheckIcon } from './icons';

export function OnboardingSection() {
	return (
		<section id="onboarding" className="onboard">
			<div className="onboard__glow-a" aria-hidden="true" />
			<div className="onboard__glow-b" aria-hidden="true" />
			<div className="onboard__grid">
				<div className="onboard__copy">
					<div className="onboard__pill">
						<span className="onboard__pulse" />A PERSON SETS IT UP · INCLUDED FREE
					</div>
					<h2 className="onboard__title">
						You don't set it up.
						<br />
						<span className="grad-text">We do — for free.</span>
					</h2>
					<p className="onboard__lead">
						Every Rivus account comes with a dedicated onboarding specialist — a real person who
						learns your business, gets everything connected, and trains Rivus to sound just like
						you. Most owners are fully live within a day.
					</p>
					<ul className="onboard__list">
						{onboardingChecklist.map((item) => (
							<li key={item}>
								<CheckIcon size={20} />
								{item}
							</li>
						))}
					</ul>
				</div>

				<div className="onboard__cta">
					<a className="btn btn--white btn--lg" href={signupUrl}>
						Claim your free onboarding
						<ArrowRightIcon size={18} />
					</a>
				</div>

				<div className="onboard__card">
					<div className="specialist">
						<div className="specialist__photo" aria-hidden="true">
							MR
						</div>
						<div className="specialist__head">
							<div className="specialist__meta">
								<div className="specialist__name">Maya R.</div>
								<div className="specialist__role">Your onboarding specialist</div>
							</div>
							<span className="specialist__avail">
								<span className="dot" />A real human
							</span>
						</div>
						<div className="specialist__stats">
							{onboardingStats.map((stat) => (
								<div key={stat.label} className="specialist__stat">
									<div className="specialist__stat-value">{stat.value}</div>
									<div className="specialist__stat-label">{stat.label}</div>
								</div>
							))}
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}

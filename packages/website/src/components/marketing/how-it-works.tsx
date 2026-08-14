import Link from 'next/link';
import { channels, outcomes, steps } from '../../lib/site';
import { BrandImg } from './brand-img';
import { ArrowRightIcon, CheckIcon, Icon } from './icons';

export function HowItWorks() {
	return (
		<section id="how" className="section section--gray">
			<div className="container">
				<div className="section-head">
					<p className="eyebrow">MEET RIVUS</p>
					<h2 className="h2">One agent. Your entire front office.</h2>
					<p className="lead">
						Rivus picks up every conversation, on every channel, and carries it all the way to a
						booked, paid job — then keeps your marketing running in the background.{' '}
						<Link href="/compare">
							See how that compares with an answering service, a hire, or voicemail.
						</Link>
					</p>
				</div>

				<div className="flow">
					<div className="flow__group">
						{channels.map((channel) => (
							<div key={channel.label} className="flow__node flow__node--channel">
								<Icon name={channel.icon} size={19} />
								{channel.label}
							</div>
						))}
					</div>
					<ArrowRightIcon className="flow__arrow" size={40} />
					<div className="flow__core">
						<div className="flow__mark">
							<BrandImg className="mark-img" src="/assets/rivus-symbol-white.svg" alt="" />
						</div>
						<span className="flow__caption">Rivus answers in seconds</span>
					</div>
					<ArrowRightIcon className="flow__arrow" size={40} />
					<div className="flow__group">
						{outcomes.map((outcome) => (
							<div key={outcome} className="flow__node flow__node--out">
								<CheckIcon size={17} />
								{outcome}
							</div>
						))}
					</div>
				</div>

				<div className="steps">
					{steps.map((step, index) => (
						<article key={step.title} className="step">
							<div className="step__num">{index + 1}</div>
							<div>
								<h3 className="step__title">{step.title}</h3>
								<p className="step__body">{step.description}</p>
							</div>
						</article>
					))}
				</div>
			</div>
		</section>
	);
}

import { appUrl } from '../../lib/site';
import { BrandImg } from './brand-img';
import { ArrowRightIcon } from './icons';
import { Link } from './link';

export function FinalCta() {
	return (
		<section id="cta" className="cta">
			<div className="cta__glow-a" aria-hidden="true" />
			<div className="cta__glow-b" aria-hidden="true" />
			<div className="cta__inner">
				<BrandImg
					className="cta__mark"
					src="/assets/rivus-symbol-white.svg"
					alt="Rivus"
					width={60}
					height={60}
				/>
				<h2 className="cta__title">
					Your phone's ringing.
					<br />
					Let Rivus get it.
				</h2>
				<p className="cta__lead">
					Start free today — your onboarding specialist will have you live by tomorrow. No credit
					card required.
				</p>
				<div className="cta__actions">
					<a className="btn btn--white" href={`${appUrl}/signup`}>
						Get started free
						<ArrowRightIcon size={19} />
					</a>
					<Link className="btn btn--ghost-dark" href="/demo">
						Book a demo
					</Link>
				</div>
			</div>
		</section>
	);
}

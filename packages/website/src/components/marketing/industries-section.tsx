import { industries } from '../../lib/industries';
import { ArrowRightIcon } from './icons';
import { Link } from './link';

/**
 * Trade cards on the home page. The hero mock is plumber-flavored, so this
 * section is how every named audience finds themselves — and how crawlers
 * discover the per-trade landing pages from the home URL.
 */
export function IndustriesSection() {
	return (
		<section id="industries" className="section section--plain">
			<div className="container">
				<div className="section-head">
					<p className="eyebrow">YOUR TRADE</p>
					<h2 className="h2">See Rivus in your world.</h2>
					<p className="lead">
						The same agent, speaking the language of your jobs — from a burst pipe at 2am to a
						Saturday cut-and-color.
					</p>
				</div>
				<div className="grid-3">
					{industries.map((industry) => (
						<article key={industry.slug} className="card">
							<h3 className="card__title">{industry.name}</h3>
							<p className="card__body">{industry.title}</p>
							<Link className="card__link" href={`/industries/${industry.slug}`}>
								Rivus for {industry.shortName}
								<ArrowRightIcon size={15} />
							</Link>
						</article>
					))}
				</div>
			</div>
		</section>
	);
}

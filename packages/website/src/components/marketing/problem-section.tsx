import { problems } from '../../lib/site';
import { Icon } from './icons';

export function ProblemSection() {
	return (
		<section id="problem" className="section section--gray">
			<div className="container">
				<div className="section-head">
					<p className="eyebrow">THE DAILY GRIND</p>
					<h2 className="h2">You didn't start your business to answer phones.</h2>
					<p className="lead">
						Every missed message is a customer calling the next name on the list. Here's what's
						quietly costing you jobs.
					</p>
				</div>
				<div className="grid-4">
					{problems.map((problem) => (
						<article key={problem.title} className="card">
							<div className={`tile tile--lg tile--${problem.tint}`}>
								<Icon name={problem.icon} size={23} />
							</div>
							<h3 className="card__title">{problem.title}</h3>
							<p className="card__body">{problem.description}</p>
						</article>
					))}
				</div>
			</div>
		</section>
	);
}

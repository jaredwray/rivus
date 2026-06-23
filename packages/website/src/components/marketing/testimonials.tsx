import { testimonials } from '../../lib/site';

export function Testimonials() {
	return (
		<section className="section section--gray">
			<div className="container">
				<div className="section-head">
					<p className="eyebrow">LOVED BY OWNERS LIKE YOU</p>
					<h2 className="h2">It pays for itself the first weekend.</h2>
				</div>
				<div className="grid-3">
					{testimonials.map((item) => (
						<figure key={item.name} className="quote">
							<div className="quote__stars" role="img" aria-label="5 out of 5 stars">
								★★★★★
							</div>
							<blockquote className="quote__text">{item.quote}</blockquote>
							<figcaption className="quote__author">
								<div className={`quote__avatar quote__avatar--${item.tint}`}>{item.initials}</div>
								<div>
									<div className="quote__name">{item.name}</div>
									<div className="quote__biz">{item.business}</div>
								</div>
							</figcaption>
						</figure>
					))}
				</div>
			</div>
		</section>
	);
}

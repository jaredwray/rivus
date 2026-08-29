import { ArrowRightIcon } from '../components/marketing/icons';
import { JsonLd } from '../components/marketing/json-ld';
import { Link } from '../components/marketing/link';
import { PageHero } from '../components/marketing/page-hero';
import { SiteFooter } from '../components/marketing/site-footer';
import { SiteNav } from '../components/marketing/site-nav';
import { allFaqEntries, faqCategories, faqCategoryAnchor } from '../lib/faq';

/** FAQPage structured data, generated from the same array the page renders. */
const faqJsonLd = {
	'@context': 'https://schema.org',
	'@type': 'FAQPage',
	mainEntity: allFaqEntries.map((entry) => ({
		'@type': 'Question',
		name: entry.question,
		acceptedAnswer: { '@type': 'Answer', text: entry.answer },
	})),
};

export function FaqPage() {
	return (
		<>
			<SiteNav />
			<main id="main">
				<PageHero
					eyebrow="FAQ"
					title="Questions, answered — the Rivus way."
					lead="Everything owners ask us before they start, in plain language. If yours isn't here, a human will answer it — that's rather the point of us."
					actions={
						<>
							<Link className="btn btn--primary btn--lg" href="/demo">
								Book a demo
								<ArrowRightIcon size={18} />
							</Link>
							<Link className="btn btn--outline btn--lg" href="/contact">
								Ask a human
							</Link>
						</>
					}
				/>

				{faqCategories.map((category, index) => (
					<section
						key={category.title}
						id={faqCategoryAnchor(category)}
						className={index % 2 === 0 ? 'section section--plain' : 'section section--gray'}
					>
						<div className="container">
							<div className="section-head">
								<p className="eyebrow">{category.eyebrow}</p>
								<h2 className="h2">{category.title}</h2>
							</div>
							<div className="faq-list">
								{category.entries.map((entry) => (
									<details key={entry.question} className="faq-item">
										<summary className="faq-item__q">{entry.question}</summary>
										<p className="faq-item__a">{entry.answer}</p>
									</details>
								))}
							</div>
						</div>
					</section>
				))}
			</main>
			<SiteFooter />
			<JsonLd data={faqJsonLd} />
		</>
	);
}

import { BrandImg } from '../components/marketing/brand-img';
import { ArrowRightIcon, CheckIcon, Icon } from '../components/marketing/icons';
import { PageHero } from '../components/marketing/page-hero';
import { SiteFooter } from '../components/marketing/site-footer';
import { SiteNav } from '../components/marketing/site-nav';
import {
	boilerplate,
	brandAssets,
	brandGuidelinesPdf,
	brandRules,
	pressEmail,
	pressFacts,
} from '../lib/press';

export function PressPage() {
	return (
		<>
			<SiteNav />
			<main id="main">
				<PageHero
					eyebrow="PRESS & BRAND"
					title="Writing about Rivus? Start here."
					lead="Company facts, ready-to-use boilerplate, and the official logo pack — everything you need to cover Rivus accurately, plus a real human on the other end of the press line."
					actions={
						<a className="btn btn--primary btn--lg" href={`mailto:${pressEmail}`}>
							Email {pressEmail}
							<ArrowRightIcon size={18} />
						</a>
					}
				/>

				<section className="section section--plain">
					<div className="container">
						<div className="section-head">
							<p className="eyebrow">BOILERPLATE</p>
							<h2 className="h2">The short version, ready to lift.</h2>
						</div>
						<div className="prose">
							<p>{boilerplate}</p>
						</div>
					</div>
				</section>

				<section className="section section--gray">
					<div className="container">
						<div className="section-head">
							<p className="eyebrow">FAST FACTS</p>
							<h2 className="h2">The company at a glance.</h2>
						</div>
						<div className="grid-4">
							{pressFacts.map((fact) => (
								<article key={fact.title} className="card">
									<div className={`tile tile--lg tile--${fact.tint}`}>
										<Icon name={fact.icon} size={22} />
									</div>
									<h3 className="card__title">{fact.title}</h3>
									<p className="card__body">{fact.description}</p>
								</article>
							))}
						</div>
					</div>
				</section>

				<section className="section section--plain">
					<div className="container">
						<div className="section-head">
							<p className="eyebrow">BRAND ASSETS</p>
							<h2 className="h2">The official logo pack.</h2>
							<p className="lead">
								Vector and PNG versions of every lockup, straight from the master files — plus the
								full brand guidelines for spacing, color, and usage.
							</p>
						</div>
						<div className="grid-3">
							{brandAssets.map((asset) => (
								<article key={asset.name} className="card">
									<BrandImg
										className="press-asset__preview"
										src={asset.preview}
										alt={`${asset.name} preview`}
										height={56}
									/>
									<h3 className="card__title">{asset.name}</h3>
									<p className="card__body">{asset.description}</p>
									<div className="press-asset__files">
										{asset.files.map((file) => (
											<a key={file.label} className="card__link" href={file.href} download>
												{file.label}
												<ArrowRightIcon size={15} />
											</a>
										))}
									</div>
								</article>
							))}
						</div>
						<div className="prose" style={{ marginTop: 34 }}>
							<ul className="feature-row__points">
								{brandRules.map((rule) => (
									<li key={rule}>
										<CheckIcon size={19} />
										{rule}
									</li>
								))}
							</ul>
							<p>
								<a className="card__link" href={brandGuidelinesPdf} download>
									Download the full brand guidelines (PDF)
									<ArrowRightIcon size={15} />
								</a>
							</p>
						</div>
					</div>
				</section>
			</main>
			<SiteFooter />
		</>
	);
}

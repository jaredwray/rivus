import { ApiStatus } from '../components/api-status';
import { FeatureCard } from '../components/feature-card';
import { features, siteConfig } from '../lib/site';

export default function HomePage() {
	return (
		<main className="page">
			<header className="hero">
				<p className="eyebrow">The Rivus platform</p>
				<h1>{siteConfig.name}</h1>
				<p className="tagline">{siteConfig.tagline}</p>
				<p className="lead">{siteConfig.description}</p>
				<div className="cta">
					<a className="button" href="https://rivus.org/docs">
						Read the docs
					</a>
					<ApiStatus />
				</div>
			</header>

			<section className="features" aria-label="Features">
				{features.map((feature) => (
					<FeatureCard key={feature.title} feature={feature} />
				))}
			</section>

			<footer className="footer">
				<p>
					© {new Date().getFullYear()} {siteConfig.name}. Built with the Rivus monorepo.
				</p>
			</footer>
		</main>
	);
}

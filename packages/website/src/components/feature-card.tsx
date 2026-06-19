import { type Feature, featureAnchor } from '../lib/site';

export function FeatureCard({ feature }: { feature: Feature }) {
	return (
		<article className="feature-card" id={featureAnchor(feature)}>
			<h3>{feature.title}</h3>
			<p>{feature.description}</p>
		</article>
	);
}

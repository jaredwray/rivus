import type { ReactNode } from 'react';

export interface PageHeroProps {
	/** Small uppercase kicker above the title. */
	eyebrow: string;
	title: string;
	lead: string;
	/** Optional CTA row (buttons/links) under the lead. */
	actions?: ReactNode;
	/** Optional extra content (e.g. a stat band) below the actions. */
	children?: ReactNode;
}

/** The light header band every info subpage opens with. */
export function PageHero({ eyebrow, title, lead, actions, children }: PageHeroProps) {
	return (
		<header className="page-hero">
			<div className="page-hero__inner">
				<p className="eyebrow">{eyebrow}</p>
				<h1 className="page-hero__title">{title}</h1>
				<p className="page-hero__lead">{lead}</p>
				{actions ? <div className="page-hero__actions">{actions}</div> : null}
				{children}
			</div>
		</header>
	);
}

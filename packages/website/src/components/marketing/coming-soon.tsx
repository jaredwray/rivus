import Link from 'next/link';
import { SiteFooter } from './site-footer';
import { SiteNav } from './site-nav';

export interface ComingSoonProps {
	/** Small uppercase kicker above the title. */
	eyebrow: string;
	title: string;
	/** One or two sentences explaining what's on the way. */
	blurb: string;
	/** Optional contact address, rendered as a mailto fallback. */
	email?: string;
}

/**
 * A placeholder page for marketing routes that are linked from the nav/footer
 * but not built yet. Reuses the legal-page layout so it inherits the site
 * chrome and centered reading column without any new styles.
 */
export function ComingSoon({ eyebrow, title, blurb, email }: ComingSoonProps) {
	return (
		<>
			<SiteNav />
			<main className="legal">
				<div className="legal__container">
					<header className="legal__head">
						<p className="eyebrow">{eyebrow}</p>
						<h1 className="legal__title">{title}</h1>
						<p className="legal__lead">{blurb}</p>
					</header>
					<div className="legal__section">
						<Link className="btn btn--primary" href="/">
							Back to home
						</Link>
					</div>
					{email ? (
						<p className="legal__footnote">
							Prefer email? Reach us at <a href={`mailto:${email}`}>{email}</a>.
						</p>
					) : null}
				</div>
			</main>
			<SiteFooter />
		</>
	);
}

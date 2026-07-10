import Link from 'next/link';
import type { ReactNode } from 'react';
import type { LegalBlock, LegalDoc } from '../../lib/legal';
import { SiteFooter } from './site-footer';
import { SiteNav } from './site-nav';

function blockKey(block: LegalBlock): string {
	return block.kind === 'text' ? block.text : block.items.join('|');
}

/**
 * Renders a legal-copy string, expanding `[label](href)` markdown links and
 * `**bold**` emphasis. Policies must cross-reference each other (carrier
 * audits expect, for example, the SMS terms to link the privacy policy), and
 * CTIA guidelines want opt-out instructions displayed in bold. Site-relative
 * hrefs get client navigation; anything else (mailto:, https:) is a plain
 * anchor.
 */
export function renderInline(text: string): ReactNode[] {
	const nodes: ReactNode[] = [];
	const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
	let cursor = 0;
	for (const match of text.matchAll(pattern)) {
		const [token, bold, label, href] = match;
		if (match.index > cursor) {
			nodes.push(text.slice(cursor, match.index));
		}
		if (href !== undefined && label !== undefined) {
			nodes.push(
				href.startsWith('/') ? (
					<Link key={`${href}-${match.index}`} href={href}>
						{label}
					</Link>
				) : (
					<a key={`${href}-${match.index}`} href={href}>
						{label}
					</a>
				),
			);
		} else {
			nodes.push(<strong key={`b-${match.index}`}>{bold}</strong>);
		}
		cursor = match.index + token.length;
	}
	if (cursor < text.length) {
		nodes.push(text.slice(cursor));
	}
	return nodes;
}

export function LegalPage({ doc }: { doc: LegalDoc }) {
	return (
		<>
			<SiteNav />
			<main id="main" className="legal">
				<div className="legal__container">
					<header className="legal__head">
						<p className="eyebrow">{doc.eyebrow}</p>
						<h1 className="legal__title">{doc.title}</h1>
						<p className="legal__updated">Last updated {doc.updated}</p>
						{doc.intro.map((paragraph) => (
							<p key={paragraph} className="legal__lead">
								{renderInline(paragraph)}
							</p>
						))}
					</header>

					{doc.sections.map((section) => (
						<section key={section.heading} className="legal__section">
							<h2 className="legal__heading">{section.heading}</h2>
							{section.blocks.map((block) =>
								block.kind === 'text' ? (
									<p key={blockKey(block)} className="legal__text">
										{renderInline(block.text)}
									</p>
								) : (
									<ul key={blockKey(block)} className="legal__list">
										{block.items.map((item) => (
											<li key={item}>{renderInline(item)}</li>
										))}
									</ul>
								),
							)}
						</section>
					))}

					<p className="legal__footnote">
						Questions? Email <a href={`mailto:${doc.contactEmail}`}>{doc.contactEmail}</a>.
					</p>
				</div>
			</main>
			<SiteFooter />
		</>
	);
}

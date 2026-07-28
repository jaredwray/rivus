import type { Metadata } from 'next';
import Link from 'next/link';
import { FinalCta } from '../../components/marketing/final-cta';
import { ArrowRightIcon } from '../../components/marketing/icons';
import { PageHero } from '../../components/marketing/page-hero';
import { SiteFooter } from '../../components/marketing/site-footer';
import { SiteNav } from '../../components/marketing/site-nav';
import { compareCaveat, compareColumns, compareRows } from '../../lib/compare';

export const metadata: Metadata = {
	title: 'Rivus vs. the alternatives — hire, answering service, or voicemail',
	description:
		'How Rivus compares with hiring a front desk, using an answering service, or letting voicemail catch it — coverage, channels, booking, and cost shape.',
	alternates: { canonical: '/compare' },
};

export default function ComparePage() {
	return (
		<>
			<SiteNav />
			<main id="main">
				<PageHero
					eyebrow="COMPARE"
					title="The four ways your phone gets answered."
					lead="Every local business already has an answering strategy — a person, a service, or a voicemail box. Here's how they actually stack up on the things that win or lose the job."
					actions={
						<>
							<Link className="btn btn--primary btn--lg" href="/demo">
								See Rivus live
								<ArrowRightIcon size={18} />
							</Link>
							<Link className="btn btn--outline btn--lg" href="/#pricing">
								See pricing
							</Link>
						</>
					}
				/>

				<section className="section section--plain">
					<div className="container">
						<div className="compare-wrap">
							<table className="compare">
								<thead>
									<tr>
										<th scope="col">
											<span className="compare__dim">What matters</span>
										</th>
										{compareColumns.map((column) => (
											<th
												key={column.key}
												scope="col"
												className={column.key === 'rivus' ? 'compare--rivus' : undefined}
											>
												<span className="compare__name">{column.name}</span>
												<span className="compare__summary">{column.summary}</span>
											</th>
										))}
									</tr>
								</thead>
								<tbody>
									{compareRows.map((row) => (
										<tr key={row.dimension}>
											<th scope="row">{row.dimension}</th>
											{/* Body cells map over the same columns as the header, so a
											    column reorder can never desync them. */}
											{compareColumns.map((column) => (
												<td
													key={column.key}
													className={column.key === 'rivus' ? 'compare--rivus' : undefined}
												>
													{row[column.key]}
												</td>
											))}
										</tr>
									))}
								</tbody>
							</table>
						</div>
						<div className="prose" style={{ marginTop: 30 }}>
							<p>{compareCaveat}</p>
						</div>
					</div>
				</section>

				<FinalCta />
			</main>
			<SiteFooter />
		</>
	);
}

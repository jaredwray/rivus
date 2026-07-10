import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CustomerJoin } from '../../../../components/marketing/customer-join';
import { SiteFooter } from '../../../../components/marketing/site-footer';
import { SiteNav } from '../../../../components/marketing/site-nav';

export const metadata: Metadata = {
	title: 'Join as a customer — Rivus',
	description: 'Add your details so Rivus can book your appointment with this business over email.',
	// A per-business utility page reached from the scheduling agent's email —
	// not a marketing destination, so keep it out of search indexes.
	robots: { index: false, follow: false },
};

export default async function CustomerJoinPage({ params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params;
	return (
		<>
			<SiteNav />
			<main id="main" className="join">
				<div className="join__container">
					{/* CustomerJoin reads the ?email= prefill via useSearchParams, which
					    Next requires to sit under a Suspense boundary. */}
					<Suspense
						fallback={
							<p className="join__status" role="status">
								Looking up the business…
							</p>
						}
					>
						<CustomerJoin slug={slug} />
					</Suspense>
				</div>
			</main>
			<SiteFooter />
		</>
	);
}

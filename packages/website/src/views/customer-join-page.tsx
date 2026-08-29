import { CustomerJoin } from '../components/marketing/customer-join';
import { SiteFooter } from '../components/marketing/site-footer';
import { SiteNav } from '../components/marketing/site-nav';

export function CustomerJoinPage({
	slug,
	emailPrefill = '',
}: {
	slug: string;
	emailPrefill?: string;
}) {
	return (
		<>
			<SiteNav />
			<main id="main" className="join">
				<div className="join__container">
					<CustomerJoin slug={slug} emailPrefill={emailPrefill} />
				</div>
			</main>
			<SiteFooter />
		</>
	);
}

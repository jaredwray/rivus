import { useEffect, useState } from 'react';
import { joinSlugFromPath } from '../../lib/join-path';
import { CustomerJoin } from './customer-join';

/**
 * Client island for `/customers/join/<slug>`. The HTML is one static file;
 * Cloudflare 200-rewrites per-business URLs onto it, and this reads the slug
 * (and optional `?email=` prefill) from the visible address.
 */
export function CustomerJoinFromPath() {
	const [slug, setSlug] = useState<string | undefined>(undefined);
	const [emailPrefill, setEmailPrefill] = useState('');

	useEffect(() => {
		setSlug(joinSlugFromPath(window.location.pathname) ?? '');
		setEmailPrefill(new URLSearchParams(window.location.search).get('email') ?? '');
	}, []);

	if (slug === undefined) {
		return (
			<p className="join__status" role="status">
				Looking up the business…
			</p>
		);
	}

	if (slug === '') {
		return (
			<div className="join-card join-card--center">
				<h1 className="join-card__title">We couldn't find this business</h1>
				<p className="join-card__lead">
					The link may be out of date, or the business may no longer use Rivus. Double-check the
					link in your email, or reply to the business directly.
				</p>
			</div>
		);
	}

	return <CustomerJoin slug={slug} emailPrefill={emailPrefill} />;
}

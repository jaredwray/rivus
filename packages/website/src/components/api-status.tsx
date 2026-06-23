'use client';

import { useEffect, useState } from 'react';
import { apiUrl } from '../lib/site';

type Status = 'loading' | 'online' | 'offline';

const labels: Record<Status, string> = {
	loading: 'Checking status…',
	online: 'All systems operational',
	offline: 'Status unavailable',
};

/**
 * Live status of the Rivus API, rendered as a small footer indicator. Pings
 * `${apiUrl}/health` once on mount; the dot color is driven by `data-status`.
 */
export function ApiStatus() {
	const [status, setStatus] = useState<Status>('loading');

	useEffect(() => {
		let active = true;
		fetch(`${apiUrl}/health`)
			.then((response) => {
				if (active) {
					setStatus(response.ok ? 'online' : 'offline');
				}
			})
			.catch(() => {
				if (active) {
					setStatus('offline');
				}
			});
		return () => {
			active = false;
		};
	}, []);

	return (
		<span className="footer__status" role="status" data-status={status}>
			<span className="dot" />
			{labels[status]}
		</span>
	);
}

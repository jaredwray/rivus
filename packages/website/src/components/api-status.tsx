'use client';

import { useEffect, useState } from 'react';
import { apiUrl } from '../lib/site';

type Status = 'loading' | 'online' | 'offline';

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
		<span className="api-status" role="status" data-status={status}>
			API status: {status}
		</span>
	);
}

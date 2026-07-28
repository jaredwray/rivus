import type { MetadataRoute } from 'next';
import { siteConfig } from '../lib/site';

/** `/manifest.webmanifest` — identity metadata for installs and pinned tabs. */
export default function manifest(): MetadataRoute.Manifest {
	return {
		name: `${siteConfig.name} — ${siteConfig.tagline}`,
		short_name: siteConfig.name,
		description: siteConfig.description,
		start_url: '/',
		display: 'browser',
		background_color: '#ffffff',
		theme_color: '#6e1ec8',
		icons: [
			{ src: '/icon.svg', type: 'image/svg+xml', sizes: 'any' },
			{ src: '/apple-icon.png', type: 'image/png', sizes: '180x180' },
		],
	};
}

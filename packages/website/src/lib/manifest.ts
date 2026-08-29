import { siteConfig } from './site';

export interface WebManifest {
	name: string;
	short_name: string;
	description: string;
	start_url: string;
	display: string;
	background_color: string;
	theme_color: string;
	icons: { src: string; type: string; sizes: string }[];
}

/** `/manifest.webmanifest` — identity metadata for installs and pinned tabs. */
export function manifest(): WebManifest {
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

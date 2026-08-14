import type { Metadata, Viewport } from 'next';
import { Montserrat } from 'next/font/google';
import type { ReactNode } from 'react';
import { isProductionEnv } from '../lib/env';
import { siteConfig } from '../lib/site';
import { baseUrl } from './sitemap';
import './globals.css';

const montserrat = Montserrat({
	subsets: ['latin'],
	weight: ['300', '400', '500', '600', '700', '800'],
	variable: '--font-montserrat',
	display: 'swap',
});

export const metadata: Metadata = {
	// Absolute base for social-card and other relative metadata URLs. Always the
	// production origin: og:image URLs must resolve publicly, and pre-production
	// deployments are noindexed anyway.
	metadataBase: new URL(baseUrl),
	title: siteConfig.title,
	description: siteConfig.description,
	// Keep every pre-production deployment (dev.rivus.ai, local builds) out of
	// search indexes; production stays fully indexable. Pairs with /robots.txt.
	robots: isProductionEnv() ? undefined : { index: false, follow: false },
	openGraph: {
		title: siteConfig.title,
		description: siteConfig.description,
		siteName: siteConfig.name,
		type: 'website',
		locale: 'en_US',
	},
	// The large-card hint; the image itself comes from the opengraph-image file
	// convention, which X and other crawlers fall back to.
	twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
	themeColor: '#6e1ec8',
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" className={montserrat.variable}>
			{/* suppressHydrationWarning: browser extensions (Grammarly, password
			    managers, dark-mode tools) inject attributes onto <body> before
			    React hydrates. The body content is server-rendered and static, so
			    this only silences that unavoidable extension noise. */}
			<body suppressHydrationWarning>
				<a className="skip-link" href="#main">
					Skip to content
				</a>
				{children}
			</body>
		</html>
	);
}

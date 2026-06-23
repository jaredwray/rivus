import type { Metadata, Viewport } from 'next';
import { Montserrat } from 'next/font/google';
import type { ReactNode } from 'react';
import { siteConfig } from '../lib/site';
import './globals.css';

const montserrat = Montserrat({
	subsets: ['latin'],
	weight: ['300', '400', '500', '600', '700', '800'],
	variable: '--font-montserrat',
	display: 'swap',
});

export const metadata: Metadata = {
	title: `${siteConfig.name} — ${siteConfig.tagline}`,
	description: siteConfig.description,
	openGraph: {
		title: `${siteConfig.name} — ${siteConfig.tagline}`,
		description: siteConfig.description,
		siteName: siteConfig.name,
		type: 'website',
	},
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
			<body suppressHydrationWarning>{children}</body>
		</html>
	);
}

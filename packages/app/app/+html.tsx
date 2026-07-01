import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * Root HTML document for the static web export (`expo export -p web`).
 *
 * This file is web-only and never runs on native. It exists so the exported
 * pages ship the head metadata iOS/Android need to treat Rivus as an
 * installable web app — most importantly the `apple-touch-icon`, without which
 * iOS "Add to Home Screen" falls back to a screenshot of the page instead of
 * showing the Rivus mark. Icons and the manifest live in `public/` and are
 * copied to the export root, so they are referenced from absolute `/` paths.
 */
export default function Root({ children }: PropsWithChildren) {
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta httpEquiv="X-UA-Compatible" content="IE=edge" />
				<meta
					name="viewport"
					content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
				/>

				{/* Default tab title — overridden per screen by useDocumentTitle once it
				    mounts, but this covers the initial paint and any screen that doesn't. */}
				<title>Rivus</title>

				{/* Browser tab + address-bar theming. */}
				<meta name="theme-color" content="#6e1ec8" />
				<meta name="application-name" content="Rivus" />

				{/* Favicons (SVG for modern browsers, PNG fallbacks). */}
				<link rel="icon" type="image/svg+xml" href="/icon.svg" />
				<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
				<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png" />

				{/* iOS Home Screen icon + standalone web-app behaviour. */}
				<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
				<meta name="apple-mobile-web-app-capable" content="yes" />
				<meta name="mobile-web-app-capable" content="yes" />
				<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
				<meta name="apple-mobile-web-app-title" content="Rivus" />

				{/* PWA manifest (Android install + metadata). */}
				<link rel="manifest" href="/manifest.webmanifest" />

				{/*
				 * Disable body scrolling on web so ScrollView components work as
				 * expected. Required by Expo Router's static rendering.
				 */}
				<ScrollViewStyleReset />
			</head>
			<body>{children}</body>
		</html>
	);
}

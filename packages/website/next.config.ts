import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
import type { NextConfig } from 'next';
import { resolveAppUrl, resolveDocsUrl } from './src/lib/env';

const nextConfig: NextConfig = {
	reactStrictMode: true,
	// @rivus/core is shipped as TypeScript source, so Next must transpile it.
	transpilePackages: ['@rivus/core'],
	env: {
		// Resolved per environment at build time (dev deploys link to
		// dev-app.rivus.ai / dev-docs.rivus.ai) and inlined into the client
		// bundle, where the build-only RIVUS_ENV variable isn't visible.
		NEXT_PUBLIC_APP_URL: resolveAppUrl(),
		NEXT_PUBLIC_DOCS_URL: resolveDocsUrl(),
	},
};

export default nextConfig;

// Wires Cloudflare bindings into `next dev`; a no-op during production builds.
initOpenNextCloudflareForDev();

import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
	reactStrictMode: true,
	// @rivus/core is shipped as TypeScript source, so Next must transpile it.
	transpilePackages: ['@rivus/core'],
};

export default nextConfig;

// Wires Cloudflare bindings into `next dev`; a no-op during production builds.
initOpenNextCloudflareForDev();

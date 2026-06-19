import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
	reactStrictMode: true,
	// @rivus/core is shipped as TypeScript source, so Next must transpile it.
	transpilePackages: ['@rivus/core'],
};

export default nextConfig;

/**
 * Whether this build targets the production Cloudflare environment.
 *
 * The deploy workflows set `RIVUS_ENV` ("development" | "production") per
 * environment. Anything other than "production" — including unset (local builds)
 * and the `development` deploy — is treated as non-production, so a
 * pre-production surface is never accidentally exposed to search crawlers.
 */
export function isProductionEnv(env?: Record<string, string | undefined>): boolean {
	// Guard the `process` reference: this helper lives in `lib/`, so a future
	// client/edge import shouldn't throw if `process` is undefined — it just
	// falls back to "not production" (block crawling), the safe default.
	const target = env ?? (typeof process !== 'undefined' ? process.env : {});
	return target.RIVUS_ENV === 'production';
}

/**
 * The product-app base URL this deployment should link to. Each marketing
 * environment points at its sibling app deployment — dev.rivus.ai must send
 * sign-ups to dev-app.rivus.ai, never the production app — with
 * `NEXT_PUBLIC_APP_URL` as an explicit override for either.
 *
 * Called from next.config.ts at build time (the deploy workflows set
 * `RIVUS_ENV` in the build job's env), which inlines the result into both the
 * server and client bundles as `NEXT_PUBLIC_APP_URL`; client components can't
 * read `RIVUS_ENV` themselves.
 */
export function resolveAppUrl(env?: Record<string, string | undefined>): string {
	const target = env ?? (typeof process !== 'undefined' ? process.env : {});
	if (target.NEXT_PUBLIC_APP_URL) {
		return target.NEXT_PUBLIC_APP_URL;
	}
	return target.RIVUS_ENV === 'development' ? 'https://dev-app.rivus.ai' : 'https://app.rivus.ai';
}

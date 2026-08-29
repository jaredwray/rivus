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
 * `PUBLIC_APP_URL` (or the legacy `NEXT_PUBLIC_APP_URL`) as an explicit
 * override for either.
 *
 * Called from astro.config.ts at build time (the deploy workflows set
 * `RIVUS_ENV` in the build job's env), which inlines the result into the
 * client bundle as `PUBLIC_APP_URL`; client islands can't read `RIVUS_ENV`
 * themselves.
 */
export function resolveAppUrl(env?: Record<string, string | undefined>): string {
	const target = env ?? (typeof process !== 'undefined' ? process.env : {});
	const override = target.PUBLIC_APP_URL ?? target.NEXT_PUBLIC_APP_URL;
	if (override) {
		// Strip trailing slashes so consumers can safely append paths
		// (`${appUrl}/signup`) without producing `https://host//signup`.
		return override.replace(/\/+$/, '');
	}
	return target.RIVUS_ENV === 'development' ? 'https://dev-app.rivus.ai' : 'https://app.rivus.ai';
}

/**
 * The docs-site base URL this deployment should link to — the docs sibling of
 * {@link resolveAppUrl}, so dev.rivus.ai sends readers to dev-docs.rivus.ai
 * rather than the production docs. Same build-time inlining contract via
 * `PUBLIC_DOCS_URL` in astro.config.ts.
 */
export function resolveDocsUrl(env?: Record<string, string | undefined>): string {
	const target = env ?? (typeof process !== 'undefined' ? process.env : {});
	const override = target.PUBLIC_DOCS_URL ?? target.NEXT_PUBLIC_DOCS_URL;
	if (override) {
		return override.replace(/\/+$/, '');
	}
	return target.RIVUS_ENV === 'development' ? 'https://dev-docs.rivus.ai' : 'https://docs.rivus.ai';
}

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

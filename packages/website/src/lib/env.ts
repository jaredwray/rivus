/**
 * Whether this build targets the production Cloudflare environment.
 *
 * The deploy workflows set `RIVUS_ENV` ("development" | "production") per
 * environment. Anything other than "production" — including unset (local builds)
 * and the `development` deploy — is treated as non-production, so a
 * pre-production surface is never accidentally exposed to search crawlers.
 */
export function isProductionEnv(env: Record<string, string | undefined> = process.env): boolean {
	return env.RIVUS_ENV === 'production';
}

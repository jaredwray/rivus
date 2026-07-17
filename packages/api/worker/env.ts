/**
 * Environment forwarding for the API container, split out from `./index.ts` so
 * the pure logic can be unit-tested without importing the
 * `@cloudflare/containers` runtime (which only loads on the Workers runtime).
 *
 * The Fastify container reads its configuration from `process.env` via
 * `loadConfig()`, but a var only reaches that process if it is forwarded here.
 * So EVERY variable `../src/config` reads must appear in {@link FORWARDED_VARS},
 * or the app reports the feature as "not configured" even when the secret is
 * set on the Worker — the exact trap the messaging channels fell into.
 * `./index.ts` asserts at compile time that each entry names a real `Env`
 * binding.
 */

/** Every Worker binding forwarded into the container's `process.env`. */
export const FORWARDED_VARS = [
	'RIVUS_ENV',
	'MONGODB_URI',
	'JWT_SECRET',
	'CORS_ORIGIN',
	'COOKIE_DOMAIN',
	'RESEND_API_KEY',
	'EMAIL_FROM',
	'APP_URL',
	'WEBSITE_URL',
	'AGENT_EMAIL_DOMAIN',
	'RESEND_WEBHOOK_SECRET',
	'OPENAI_API_KEY',
	'OPENAI_MODEL',
	'GOOGLE_GENERATIVE_AI_API_KEY',
	'GEMINI_MODEL',
	'XAI_API_KEY',
	'XAI_MODEL',
	'ANTHROPIC_API_KEY',
	'ANTHROPIC_MODEL',
	// The chat assistant's web tools — search (Brave) and browse (ZenRows).
	// Missing here = the chat reports the tool "not enabled" even when the
	// secret is set on the Worker.
	'BRAVE_SEARCH_API_KEY',
	'ZENROWS_API_KEY',
	// Messaging providers — the container reads these in `loadConfig` to pick the
	// WhatsApp/SMS/voice sender + provisioner. Missing here = "channel not
	// configured" in the app even when the secret is set on the Worker.
	'TWILIO_ACCOUNT_SID',
	'TWILIO_AUTH_TOKEN',
	'TWILIO_API_URL',
	'TWILIO_WHATSAPP_WEBHOOK_URL',
	'TWILIO_SMS_WEBHOOK_URL',
	'TWILIO_VOICE_WEBHOOK_URL',
	'TWILIO_NUMBER_COUNTRY',
	'PLIVO_AUTH_ID',
	'PLIVO_AUTH_TOKEN',
	'PLIVO_API_URL',
	'PLIVO_WEBHOOK_URL',
	'PLIVO_SMS_WEBHOOK_URL',
	'PLIVO_NUMBER_COUNTRY',
	'ZERNIO_API_KEY',
	'ZERNIO_API_URL',
	'ZERNIO_WEBHOOK_SECRET',
	'ZERNIO_VERIFY_TOKEN',
] as const;

/**
 * The subset of `keys` that `read` returns a non-empty string for, as a plain
 * map. An unset binding is dropped so it never reaches the container as the
 * string "undefined"; keys with a default in `loadConfig` (e.g. `*_API_URL`)
 * simply fall back to that default when unset.
 */
export function forwardedEnv(
	keys: readonly string[],
	read: (key: string) => unknown,
): Record<string, string> {
	const forwarded: Record<string, string> = {};
	for (const key of keys) {
		const value = read(key);
		if (typeof value === 'string' && value !== '') {
			forwarded[key] = value;
		}
	}
	return forwarded;
}

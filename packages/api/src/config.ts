import { z } from 'zod';

const DEV_JWT_SECRET = 'dev-secret-change-me';

const envSchema = z
	.object({
		NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
		// Which deployed Rivus environment this container is — `development`
		// (dev-api.rivus.ai) or `production` (api.rivus.ai). It's distinct from
		// NODE_ENV on purpose: both deployed containers run NODE_ENV=production, so
		// this is the only signal that tells the dev deployment apart from prod. It
		// gates the staff-only account seeder (`POST /v1/admin/seed`), which must
		// exist on the dev deployment but never in production. Forwarded from the
		// front-door Worker's `vars` (see worker/index.ts + wrangler.jsonc); unset in
		// local development, where NODE_ENV=development already enables the seeder.
		// Kept a free string (not an enum) so an unexpected value never blocks boot —
		// the seeder gate matches `development` exactly, so anything else fails safe.
		RIVUS_ENV: z.string().optional(),
		API_HOST: z.string().default('0.0.0.0'),
		API_PORT: z.coerce.number().int().positive().max(65535).default(4000),
		MONGODB_URI: z
			.string()
			.default('mongodb://localhost:27017/rivus?replicaSet=rs0&directConnection=true'),
		JWT_SECRET: z.string().min(8).default(DEV_JWT_SECRET),
		JWT_EXPIRES_IN: z.string().default('7d'),
		// Domain the session cookie is scoped to. Unset (the default) makes it a
		// host-only cookie for the API's own host. Set it to the shared parent domain
		// (e.g. `.rivus.ai`) so sibling subdomains — the app *and the agent* — receive
		// the cookie, which is what lets a web user chat with an authenticated agent.
		COOKIE_DOMAIN: z.string().min(1).optional(),
		LOG_LEVEL: z
			.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
			.default('info'),
		CORS_ORIGIN: z.string().default('*'),
		// --- Email (Resend) ---
		// API key for Resend. When unset, the API still runs but invitation emails
		// are not delivered (a no-op mailer logs a warning at startup).
		RESEND_API_KEY: z.string().min(1).optional(),
		// The `from` address for outbound mail. Resend accepts a bare address or a
		// `Name <address>` form; the address's domain must be verified in Resend.
		EMAIL_FROM: z.string().min(3).default('Rivus <hello@rivus.ai>'),
		// Base URL of the app, used to build the link in invitation emails.
		APP_URL: z.string().url().default('https://app.rivus.ai'),
		// Base URL of the marketing website, used to build the customer self-signup
		// link the scheduling agent emails to unrecognized senders.
		WEBSITE_URL: z.url().default('https://rivus.ai'),
		// --- Agent email channel (scheduling over email) ---
		// Domain of the per-account agent addresses customers write to. The local
		// part identifies the account (its slug or id): `cascade-plumbing@riv.us`.
		// Must be configured as an inbound (receiving) domain in Resend.
		AGENT_EMAIL_DOMAIN: z.string().min(3).default('riv.us'),
		// Signing secret (`whsec_…`) for Resend's inbound-email webhook. When set,
		// every webhook delivery must carry a valid Svix signature. When unset, the
		// webhook accepts unsigned payloads in development/tests but refuses to
		// serve at all in production — never unauthenticated in prod, and never a
		// hard boot failure for deployments that don't use the email channel.
		RESEND_WEBHOOK_SECRET: z.string().min(1).optional(),
		// --- WhatsApp channel (zernio) ---
		// Base URL of the zernio API (WhatsApp Business provider), per zernio's docs.
		// Overridable so a self-hosted/staging zernio can be targeted; the send +
		// provision leaf paths hang off it.
		ZERNIO_API_URL: z.url().default('https://zernio.com/api/v1'),
		// API key for zernio. When unset, WhatsApp degrades to a no-op sender +
		// provisioner (a deterministic fake number in development) so the API still
		// runs and tests without zernio credentials — mirroring the Resend gate.
		ZERNIO_API_KEY: z.string().min(1).optional(),
		// Signing secret for zernio's inbound webhook. When set, every delivery must
		// carry a valid signature; when unset, dev/test accept unsigned payloads but
		// production refuses the webhook route (503) until it's configured.
		ZERNIO_WEBHOOK_SECRET: z.string().min(1).optional(),
		// Verify token for the GET webhook handshake some WhatsApp providers require
		// to register a webhook URL. When unset, the handshake endpoint 404s.
		ZERNIO_VERIFY_TOKEN: z.string().min(1).optional(),
		// --- WhatsApp channel (Plivo, the primary provider) ---
		// Plivo account credentials (Console → API keys). When both are set, Plivo is
		// the active WhatsApp provider — sender and number provisioner — and the Plivo
		// webhook verifies deliveries with the auth token (Plivo signs URL + nonce
		// with it; there is no separate webhook secret). When unset, WhatsApp falls
		// back to zernio (above), else to a no-op — mirroring the Resend gate.
		PLIVO_AUTH_ID: z.string().min(1).optional(),
		PLIVO_AUTH_TOKEN: z.string().min(1).optional(),
		// Base URL of Plivo's REST API; the account-scoped resource paths hang off it.
		PLIVO_API_URL: z.url().default('https://api.plivo.com/v1'),
		// The public URL of this API's Plivo *WhatsApp* webhook
		// (…/v1/channels/whatsapp/plivo/inbound as reachable from the internet), i.e.
		// the exact URL configured in the Plivo console. Used two ways: it pins the
		// URL signature validation recomputes (Plivo signs the URL it calls, so a
		// rewriting proxy in front of the API would otherwise break verification),
		// and it rides along on every send as the delivery-status callback so
		// failures flag the conversation. When unset, verification derives the URL
		// from the request and sends carry no callback.
		PLIVO_WEBHOOK_URL: z.url().optional(),
		// The SMS counterpart: the public URL of …/v1/channels/sms/plivo/inbound,
		// with the same two roles (signature pinning + per-send status callback).
		PLIVO_SMS_WEBHOOK_URL: z.url().optional(),
		// ISO 3166-1 alpha-2 country whose numbers the provisioner rents.
		PLIVO_NUMBER_COUNTRY: z.string().length(2).default('US'),
		// --- AI (duplicate-FAQ detection) ---
		// The knowledge base's "is this a duplicate?" check runs through the AI SDK,
		// so any provider whose key is set can serve it. OpenAI is the primary; the
		// rest act as backups (tried in order when an earlier provider errors). When
		// no key is set the check is a no-op (the "Add FAQ" flow never reports a
		// duplicate), so none of these are required and none gate production boot.
		OPENAI_API_KEY: z.string().min(1).optional(),
		OPENAI_MODEL: z.string().min(1).default('gpt-5.4-mini'),
		// Embedding model for semantic FAQ retrieval (used when a knowledge base grows
		// past the prompt's candidate cap, so the most *relevant* FAQs — not just the
		// newest — are sent to the model). The query and FAQs must be embedded by the
		// same model, so retrieval uses a single provider: OpenAI when its key is set,
		// otherwise Google. Both default to a small, inexpensive model.
		OPENAI_EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small'),
		GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
		GEMINI_MODEL: z.string().min(1).default('gemini-2.5-flash'),
		GOOGLE_EMBEDDING_MODEL: z.string().min(1).default('text-embedding-004'),
		XAI_API_KEY: z.string().min(1).optional(),
		XAI_MODEL: z.string().min(1).default('grok-4-fast'),
		ANTHROPIC_API_KEY: z.string().min(1).optional(),
		ANTHROPIC_MODEL: z.string().min(1).default('claude-haiku-4-5'),
	})
	.superRefine((env, ctx) => {
		// In production, refuse to boot with the well-known dev secret or a weak one.
		if (env.NODE_ENV !== 'production') {
			return;
		}
		if (env.JWT_SECRET === DEV_JWT_SECRET) {
			ctx.addIssue({
				code: 'custom',
				path: ['JWT_SECRET'],
				message: 'JWT_SECRET must be set to a strong, non-default value in production',
			});
		} else if (env.JWT_SECRET.length < 32) {
			ctx.addIssue({
				code: 'custom',
				path: ['JWT_SECRET'],
				message: 'JWT_SECRET must be at least 32 characters in production',
			});
		}
		// Auth is passwordless: without a real mailer the sign-in code is never
		// delivered, so refuse to boot rather than silently break login/signup.
		if (!env.RESEND_API_KEY) {
			ctx.addIssue({
				code: 'custom',
				path: ['RESEND_API_KEY'],
				message:
					'RESEND_API_KEY must be set in production — passwordless auth emails the one-time sign-in code',
			});
		}
	});

export type Config = z.infer<typeof envSchema>;

/** Parse and validate process environment into a typed config object. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	return envSchema.parse(env);
}

/**
 * Whether the development-only account seeder route (`POST /v1/admin/seed`)
 * should be registered. The route is always additionally gated to Rivus staff.
 *
 * It must exist on a local dev API (`NODE_ENV=development`) and on the deployed
 * Rivus *development* environment — where the container runs NODE_ENV=production
 * just like prod, so `RIVUS_ENV=development` is what distinguishes it. Enabled
 * when either signal says development; deliberately off in production, including
 * the fail-safe case where `RIVUS_ENV` is unset or unexpected (then only a local
 * `NODE_ENV=development` can turn it on, never a production container).
 */
export function isSeedingEnabled(config: Pick<Config, 'NODE_ENV' | 'RIVUS_ENV'>): boolean {
	return config.RIVUS_ENV === 'development' || config.NODE_ENV === 'development';
}

/** What `@fastify/cors` accepts for its `origin` option. */
export type CorsOrigin = boolean | string | RegExp | Array<string | RegExp>;

/**
 * Translate the `CORS_ORIGIN` env string into a value `@fastify/cors` understands.
 *
 * - `*` (the default) allows any origin.
 * - A comma-separated list yields multiple allowed origins.
 * - An entry containing `*` is a wildcard — e.g. `*.rivus.ai` matches any single
 *   subdomain (`app.rivus.ai`, `www.rivus.ai`) over http/https — and becomes an
 *   anchored RegExp, since `@fastify/cors` only does exact matches on strings.
 * - Any other entry is matched exactly.
 */
export function parseCorsOrigin(value: string): CorsOrigin {
	const entries = value
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
	// A bare `*` (the default) short-circuits to "allow any origin".
	if (entries.includes('*')) {
		return '*';
	}
	const matchers = entries.map(toOriginMatcher);
	const [first, ...rest] = matchers;
	if (first === undefined) {
		return false;
	}
	return rest.length === 0 ? first : matchers;
}

function toOriginMatcher(entry: string): string | RegExp {
	if (!entry.includes('*')) {
		return entry;
	}
	// Escape every regex metacharacter (including `*`), then turn the escaped `*`
	// back into a single-label wildcard so `*.rivus.ai` matches `app.rivus.ai`
	// but not `a.b.rivus.ai` or the bare `rivus.ai`.
	const escaped = entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '[^.]+');
	// Origin headers always carry a scheme; allow http/https when none is given.
	const pattern = entry.includes('://') ? escaped : `https?://${escaped}`;
	return new RegExp(`^${pattern}$`);
}

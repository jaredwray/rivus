import { z } from 'zod';

const DEV_JWT_SECRET = 'dev-secret-change-me';

const envSchema = z
	.object({
		NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
		API_HOST: z.string().default('0.0.0.0'),
		API_PORT: z.coerce.number().int().positive().max(65535).default(4000),
		MONGODB_URI: z
			.string()
			.default('mongodb://localhost:27017/rivus?replicaSet=rs0&directConnection=true'),
		JWT_SECRET: z.string().min(8).default(DEV_JWT_SECRET),
		JWT_EXPIRES_IN: z.string().default('7d'),
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
		// --- AI (duplicate-FAQ detection) ---
		// The knowledge base's "is this a duplicate?" check runs through the AI SDK,
		// so any provider whose key is set can serve it. OpenAI is the primary; the
		// rest act as backups (tried in order when an earlier provider errors). When
		// no key is set the check is a no-op (the "Add FAQ" flow never reports a
		// duplicate), so none of these are required and none gate production boot.
		OPENAI_API_KEY: z.string().min(1).optional(),
		OPENAI_MODEL: z.string().min(1).default('gpt-5.4-mini'),
		GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
		GEMINI_MODEL: z.string().min(1).default('gemini-2.5-flash'),
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

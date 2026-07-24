import { Container, getContainer } from '@cloudflare/containers';
import { FORWARDED_VARS, forwardedEnv } from './env';

/** Bindings available to the front-door Worker and the container Durable Object. */
export interface Env {
	API_CONTAINER: DurableObjectNamespace<ApiContainer>;
	MONGODB_URI: string;
	JWT_SECRET: string;
	CORS_ORIGIN: string;
	RESEND_API_KEY: string;
	EMAIL_FROM: string;
	APP_URL: string;
	// Base URL of the marketing website (customer self-signup links). Optional so
	// deployments predating the agent email channel keep booting with the default.
	WEBSITE_URL?: string;
	// Agent email channel: the per-account inbound address domain and the Svix
	// signing secret for Resend's `email.received` webhook. Both optional — the
	// webhook route fails closed (503) in production when the secret is unset.
	AGENT_EMAIL_DOMAIN?: string;
	RESEND_WEBHOOK_SECRET?: string;
	// Which deployed Rivus environment this is (`development` | `production`). Set
	// per environment in wrangler.jsonc `vars`; gates the staff-only account seeder
	// (the deployed dev API exposes it, production never does). Optional so a local
	// `wrangler dev` without it still boots.
	RIVUS_ENV?: string;
	// Optional: scopes the session cookie to a parent domain (e.g. `.rivus.ai`) so
	// sibling subdomains (the app and the agent) receive it. Unset → host-only.
	COOKIE_DOMAIN?: string;
	// AI provider keys + model overrides for duplicate-FAQ detection (all optional;
	// when none is set the check degrades to a no-op).
	OPENAI_API_KEY?: string;
	OPENAI_MODEL?: string;
	GOOGLE_GENERATIVE_AI_API_KEY?: string;
	GEMINI_MODEL?: string;
	XAI_API_KEY?: string;
	XAI_MODEL?: string;
	ANTHROPIC_API_KEY?: string;
	ANTHROPIC_MODEL?: string;
	// The chat's website audit (both optional; ZenRows fetches the site, Brave
	// adds the presence check — unset = the audit says it's not enabled).
	ZENROWS_API_KEY?: string;
	BRAVE_SEARCH_API_KEY?: string;
	// Messaging channels (WhatsApp / SMS / voice). Twilio is the primary provider,
	// Plivo is retained during the migration, and zernio is the WhatsApp-only
	// alternative. All optional — an unset provider degrades to a no-op, and only
	// the ones actually set are forwarded to the container (see FORWARDED_VARS).
	// The `*_API_URL` / `*_NUMBER_COUNTRY` keys have defaults in `loadConfig`, so
	// leaving them unset is fine; the credentials and webhook URLs are what matter.
	TWILIO_ACCOUNT_SID?: string;
	TWILIO_AUTH_TOKEN?: string;
	TWILIO_API_URL?: string;
	TWILIO_WHATSAPP_WEBHOOK_URL?: string;
	TWILIO_SMS_WEBHOOK_URL?: string;
	TWILIO_VOICE_WEBHOOK_URL?: string;
	TWILIO_NUMBER_COUNTRY?: string;
	PLIVO_AUTH_ID?: string;
	PLIVO_AUTH_TOKEN?: string;
	PLIVO_API_URL?: string;
	PLIVO_WEBHOOK_URL?: string;
	PLIVO_SMS_WEBHOOK_URL?: string;
	PLIVO_NUMBER_COUNTRY?: string;
	ZERNIO_API_KEY?: string;
	ZERNIO_API_URL?: string;
	ZERNIO_WEBHOOK_SECRET?: string;
	ZERNIO_VERIFY_TOKEN?: string;
}

// Compile-time guard: every forwarded var names a real `Env` binding, so a typo
// or a key removed from `Env` fails the build here rather than silently dropping
// a variable from the container. Used by `envVars` below, so it isn't dead code.
const FORWARDED: readonly (keyof Env)[] = FORWARDED_VARS;

/**
 * The Fastify API needs Node and the MongoDB driver, so it can't run on the
 * Workers runtime — it ships as a container (see ../Dockerfile). This Durable
 * Object is the Cloudflare-side handle to that container. Secrets set with
 * `wrangler secret put` and `vars` from wrangler.jsonc arrive on `this.env`;
 * we forward them into the container's process environment so Fastify's
 * `loadConfig()` sees them as `process.env.*`.
 */
export class ApiContainer extends Container<Env> {
	override defaultPort = 4000;
	override sleepAfter = '10m';
	// A data property (not a getter): the base Container constructor assigns
	// `this.envVars`, so a getter-only override would throw. Only the bindings
	// actually set are forwarded, so an unset secret never reaches the container
	// as the string "undefined".
	override envVars = {
		NODE_ENV: 'production',
		...forwardedEnv(FORWARDED, (key) => this.env[key as keyof Env]),
	};
}

export default {
	fetch(request: Request, env: Env): Response | Promise<Response> {
		// Route every request to a single long-lived container instance.
		return getContainer(env.API_CONTAINER).fetch(request);
	},
} satisfies ExportedHandler<Env>;

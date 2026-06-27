import { Container, getContainer } from '@cloudflare/containers';

/** Bindings available to the front-door Worker and the container Durable Object. */
export interface Env {
	API_CONTAINER: DurableObjectNamespace<ApiContainer>;
	MONGODB_URI: string;
	JWT_SECRET: string;
	CORS_ORIGIN: string;
	RESEND_API_KEY: string;
	EMAIL_FROM: string;
	APP_URL: string;
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
}

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
	// `this.envVars`, so a getter-only override would throw. Spread each binding
	// only when set so an unset secret never reaches the container as "undefined".
	override envVars = {
		NODE_ENV: 'production',
		...(this.env.MONGODB_URI ? { MONGODB_URI: this.env.MONGODB_URI } : {}),
		...(this.env.JWT_SECRET ? { JWT_SECRET: this.env.JWT_SECRET } : {}),
		...(this.env.CORS_ORIGIN ? { CORS_ORIGIN: this.env.CORS_ORIGIN } : {}),
		...(this.env.COOKIE_DOMAIN ? { COOKIE_DOMAIN: this.env.COOKIE_DOMAIN } : {}),
		...(this.env.RESEND_API_KEY ? { RESEND_API_KEY: this.env.RESEND_API_KEY } : {}),
		...(this.env.EMAIL_FROM ? { EMAIL_FROM: this.env.EMAIL_FROM } : {}),
		...(this.env.APP_URL ? { APP_URL: this.env.APP_URL } : {}),
		...(this.env.OPENAI_API_KEY ? { OPENAI_API_KEY: this.env.OPENAI_API_KEY } : {}),
		...(this.env.OPENAI_MODEL ? { OPENAI_MODEL: this.env.OPENAI_MODEL } : {}),
		...(this.env.GOOGLE_GENERATIVE_AI_API_KEY
			? { GOOGLE_GENERATIVE_AI_API_KEY: this.env.GOOGLE_GENERATIVE_AI_API_KEY }
			: {}),
		...(this.env.GEMINI_MODEL ? { GEMINI_MODEL: this.env.GEMINI_MODEL } : {}),
		...(this.env.XAI_API_KEY ? { XAI_API_KEY: this.env.XAI_API_KEY } : {}),
		...(this.env.XAI_MODEL ? { XAI_MODEL: this.env.XAI_MODEL } : {}),
		...(this.env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: this.env.ANTHROPIC_API_KEY } : {}),
		...(this.env.ANTHROPIC_MODEL ? { ANTHROPIC_MODEL: this.env.ANTHROPIC_MODEL } : {}),
	};
}

export default {
	fetch(request: Request, env: Env): Response | Promise<Response> {
		// Route every request to a single long-lived container instance.
		return getContainer(env.API_CONTAINER).fetch(request);
	},
} satisfies ExportedHandler<Env>;

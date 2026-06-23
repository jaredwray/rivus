import { Container, getContainer } from '@cloudflare/containers';

/** Bindings available to the front-door Worker and the container Durable Object. */
export interface Env {
	API_CONTAINER: DurableObjectNamespace<ApiContainer>;
	MONGODB_URI: string;
	JWT_SECRET: string;
	CORS_ORIGIN: string;
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
	override envVars = {
		NODE_ENV: 'production',
		MONGODB_URI: this.env.MONGODB_URI,
		JWT_SECRET: this.env.JWT_SECRET,
		CORS_ORIGIN: this.env.CORS_ORIGIN,
	};
}

export default {
	fetch(request: Request, env: Env): Response | Promise<Response> {
		// Route every request to a single long-lived container instance.
		return getContainer(env.API_CONTAINER).fetch(request);
	},
} satisfies ExportedHandler<Env>;

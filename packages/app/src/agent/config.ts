/**
 * Resolve where the Rivus agent (the Cloudflare Agent service, `@rivus/agent`)
 * lives. Like the API config, `EXPO_PUBLIC_*` is inlined by the Expo bundler, so
 * it is safe to read on the client. We fall back to the local `wrangler dev`
 * address so the chat works out of the box during development.
 */
export const DEFAULT_AGENT_URL = 'http://localhost:8787';

/**
 * Path the Agents SDK routes on: `/agents/<binding-kebab-case>/<instance>`. The
 * agent's Durable Object binding is `RivusAgent`, so the segment is
 * `rivus-agent`; `default` is the shared conversation instance the app talks to.
 */
export const RIVUS_AGENT_PATH = '/agents/rivus-agent/default';

/** The build-time value of the one `EXPO_PUBLIC_*` var this module reads. */
function ambientEnv(): Record<string, string | undefined> {
	if (typeof process === 'undefined' || typeof process.env === 'undefined') {
		return {};
	}
	// Referenced as a literal member expression so Metro can statically inline it.
	return { EXPO_PUBLIC_AGENT_URL: process.env.EXPO_PUBLIC_AGENT_URL };
}

/** Drop any trailing slashes so a path can be safely appended. */
function stripTrailingSlash(value: string): string {
	return value.replace(/\/+$/, '');
}

export function getAgentBaseUrl(env: Record<string, string | undefined> = ambientEnv()): string {
	const fromEnv = env.EXPO_PUBLIC_AGENT_URL?.trim();
	return fromEnv && fromEnv.length > 0 ? stripTrailingSlash(fromEnv) : DEFAULT_AGENT_URL;
}

/** The absolute endpoint the app posts chat messages to. */
export function getAgentEndpoint(base: string = getAgentBaseUrl()): string {
	return `${stripTrailingSlash(base)}${RIVUS_AGENT_PATH}`;
}

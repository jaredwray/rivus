import { routeAgentRequest } from 'agents';
import { RivusAgent } from './agent';
import { handlePublicRoute, notFoundResponse } from './http';
import type { Env } from './types';

// The Durable Object class must be exported from the Worker's entrypoint so the
// runtime can find it for the `RivusAgent` binding.
export { RivusAgent };

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		// Health, root, and CORS preflights are answered without spinning up an
		// agent instance.
		const direct = handlePublicRoute(request, env);
		if (direct) {
			return direct;
		}

		// Everything under `/agents/:agent/:name` is dispatched to the matching
		// Durable Object by the Agents SDK; it returns null when nothing matches.
		const routed = await routeAgentRequest(request, env);
		return routed ?? notFoundResponse(request, new URL(request.url).pathname, env);
	},
} satisfies ExportedHandler<Env>;

import { Agent } from 'agents';
import { handleChat } from './http';
import type { Env, RivusAgentState } from './types';

/**
 * The Rivus agent — a Cloudflare Agent, which is a SQLite-backed Durable Object
 * with conversation state baked in. Every `/agents/rivus-agent/:name` request is
 * routed to the instance named `:name`, so each conversation gets its own
 * addressable, stateful agent.
 *
 * This class is intentionally a thin adapter: the reply logic lives in the pure,
 * unit-tested `conversation`/`http` modules. `onRequest` records that it saw the
 * message (proving state persists) and hands off to `handleChat`.
 */
export class RivusAgent extends Agent<Env, RivusAgentState> {
	override initialState: RivusAgentState = { messagesSeen: 0 };

	override async onRequest(request: Request): Promise<Response> {
		if (request.method === 'POST') {
			this.setState({ messagesSeen: this.state.messagesSeen + 1 });
		}
		return handleChat(request);
	}
}

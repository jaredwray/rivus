import { handleRequest } from './router';
import { runTask, scheduledTaskNames } from './tasks';
import type { Env } from './types';

export default {
	fetch(request: Request, env: Env): Promise<Response> {
		return handleRequest(request, env);
	},

	scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
		const context = { env, fetch };
		ctx.waitUntil(Promise.all(scheduledTaskNames.map((name) => runTask(name, context))));
	},
} satisfies ExportedHandler<Env>;

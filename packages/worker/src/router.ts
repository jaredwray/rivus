import { listTasks, runTask } from './tasks';
import type { Env, TaskContext } from './types';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

const RUN_PATH = /^\/tasks\/([\w-]+)\/run$/;

/**
 * Route an incoming request. `fetchImpl` is injected so task handlers that hit
 * the network can be tested without real I/O.
 */
export async function handleRequest(
	request: Request,
	env: Env,
	fetchImpl: typeof fetch = fetch,
): Promise<Response> {
	const url = new URL(request.url);
	const context: TaskContext = { env, fetch: fetchImpl };

	if (url.pathname === '/health') {
		return json({ status: 'ok' });
	}

	if (url.pathname === '/tasks') {
		return json({ tasks: listTasks() });
	}

	const runMatch = RUN_PATH.exec(url.pathname);
	if (runMatch) {
		if (request.method !== 'POST') {
			return json({ error: 'Method Not Allowed', message: 'Use POST to run a task' }, 405);
		}
		const name = runMatch[1] ?? '';
		try {
			return json(await runTask(name, context));
		} catch {
			return json({ error: 'Not Found', message: `Unknown task: ${name}` }, 404);
		}
	}

	return json(
		{ error: 'Not Found', message: `No route for ${request.method} ${url.pathname}` },
		404,
	);
}

import type { TaskContext, TaskHandler, TaskResult } from './types';

const HEALTHCHECK_TIMEOUT_MS = 5000;

/** Ping the Rivus API health endpoint and report whether it is reachable. */
const healthcheck: TaskHandler = async ({ env, fetch }) => {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), HEALTHCHECK_TIMEOUT_MS);
	try {
		const response = await fetch(`${env.API_BASE_URL}/health`, { signal: controller.signal });
		return {
			task: 'healthcheck',
			ok: response.ok,
			detail: `api responded ${response.status}`,
		};
	} catch (error) {
		return {
			task: 'healthcheck',
			ok: false,
			detail: error instanceof Error ? error.message : 'request failed',
		};
	} finally {
		clearTimeout(timeout);
	}
};

/** A trivial task that always succeeds — useful as a liveness signal. */
const heartbeat: TaskHandler = async () => ({
	task: 'heartbeat',
	ok: true,
	detail: new Date().toISOString(),
});

export const tasks: Record<string, TaskHandler> = { healthcheck, heartbeat };

/** Tasks that run automatically on the cron schedule. */
export const scheduledTaskNames = ['healthcheck', 'heartbeat'] as const;

export function listTasks(): string[] {
	return Object.keys(tasks);
}

export async function runTask(name: string, context: TaskContext): Promise<TaskResult> {
	const handler = tasks[name];
	if (!handler) {
		throw new Error(`Unknown task: ${name}`);
	}
	return handler(context);
}

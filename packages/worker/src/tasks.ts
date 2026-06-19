import type { TaskContext, TaskHandler, TaskResult } from './types';

/** Ping the Rivus API health endpoint and report whether it is reachable. */
const healthcheck: TaskHandler = async ({ env, fetch }) => {
	try {
		const response = await fetch(`${env.API_BASE_URL}/health`);
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

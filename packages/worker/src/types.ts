/** Bindings configured in wrangler.jsonc (and any secrets at deploy time). */
export interface Env {
	API_BASE_URL: string;
}

export interface TaskContext {
	env: Env;
	/** Injected so tasks that call the network are trivially testable. */
	fetch: typeof fetch;
}

export interface TaskResult {
	task: string;
	ok: boolean;
	detail: string;
}

export type TaskHandler = (context: TaskContext) => Promise<TaskResult>;

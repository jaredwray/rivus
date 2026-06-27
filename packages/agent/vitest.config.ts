import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json-summary', 'html'],
			// Coverage is scoped to the pure, runtime-agnostic modules. `agent.ts` and
			// `index.ts` are the thin Workers-runtime adapters: they import the Agents
			// SDK (which pulls in `cloudflare:workers`, unavailable under Node), so they
			// are validated by `wrangler deploy --dry-run` and local `wrangler dev`
			// rather than unit tests — see README.
			include: [
				'src/conversation.ts',
				'src/http.ts',
				'src/auth.ts',
				'src/api.ts',
				'src/intent.ts',
				'src/assistant.ts',
			],
			exclude: ['src/**/*.test.ts'],
			thresholds: {
				lines: 90,
				functions: 90,
				branches: 80,
				statements: 90,
			},
		},
	},
});

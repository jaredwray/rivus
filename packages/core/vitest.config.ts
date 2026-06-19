import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json-summary', 'html'],
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/types.ts'],
			thresholds: {
				lines: 100,
				functions: 100,
				branches: 100,
				statements: 100,
			},
		},
	},
});

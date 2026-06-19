import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json-summary', 'html'],
			include: ['src/api/**/*.ts'],
			exclude: ['src/**/*.test.ts'],
			thresholds: {
				lines: 90,
				functions: 90,
				statements: 90,
				branches: 80,
			},
		},
	},
});

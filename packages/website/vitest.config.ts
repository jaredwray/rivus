import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'jsdom',
		globals: true,
		include: ['src/**/*.test.{ts,tsx}'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json-summary', 'html'],
			include: ['src/**/*.{ts,tsx}'],
			exclude: ['src/**/*.test.{ts,tsx}', 'src/env.d.ts', 'src/pages/**'],
			thresholds: {
				lines: 80,
				functions: 80,
				branches: 70,
				statements: 80,
			},
		},
	},
});

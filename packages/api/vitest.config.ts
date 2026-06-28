import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['test/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json-summary', 'html'],
			include: ['src/**/*.ts'],
			exclude: [
				'src/index.ts',
				'src/server.ts',
				'src/openapi.ts',
				// Thin Mongo wrapper around the unit-tested pure logic in seed-data.ts.
				'src/seed.ts',
				'src/db/**',
				'src/repositories/mongo.ts',
				'src/types.ts',
				'src/repositories/types.ts',
			],
			thresholds: {
				lines: 90,
				functions: 90,
				branches: 80,
				statements: 90,
			},
		},
	},
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
	// Transform JSX/TSX with esbuild's automatic runtime — no Vite React plugin
	// needed for tests, which keeps us off its Vite 8 peer requirement.
	esbuild: { jsx: 'automatic' },
	test: {
		environment: 'jsdom',
		globals: true,
		include: ['src/**/*.test.{ts,tsx}'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json-summary', 'html'],
			include: ['src/**/*.{ts,tsx}'],
			exclude: ['src/**/*.test.{ts,tsx}', 'src/app/layout.tsx'],
			thresholds: {
				lines: 80,
				functions: 80,
				branches: 70,
				statements: 80,
			},
		},
	},
});

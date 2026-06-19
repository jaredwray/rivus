import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm'],
	platform: 'node',
	target: 'node22',
	dts: false,
	clean: true,
	// Bundle the workspace package (consumed as TypeScript source) into the output.
	deps: { alwaysBundle: [/^@rivus\//] },
});

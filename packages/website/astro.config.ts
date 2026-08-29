import react from '@astrojs/react';
import { defineConfig } from 'astro/config';
import { resolveAppUrl, resolveDocsUrl } from './src/lib/env';
import { rewriteJoinRequestUrl } from './src/lib/join-path';

// Resolve per-environment sibling URLs at build time (dev.rivus.ai →
// dev-app / dev-docs) and expose them as PUBLIC_* so client islands can
// read them. An explicit PUBLIC_* / NEXT_PUBLIC_* override still wins.
process.env.PUBLIC_APP_URL ??= resolveAppUrl();
process.env.PUBLIC_DOCS_URL ??= resolveDocsUrl();

/**
 * `/customers/join/<slug>` is one static page. Production uses
 * `public/_redirects` (Cloudflare 200 rewrite). Astro's preview server
 * strips user Vite plugins, so this hook only runs in `astro dev`.
 */
function customerJoinRewrite() {
	function rewrite(req: { url?: string }, _res: unknown, next: () => void) {
		if (req.url !== undefined) {
			req.url = rewriteJoinRequestUrl(req.url);
		}
		next();
	}
	return {
		name: 'customer-join-rewrite',
		configureServer(server: { middlewares: { use: (fn: typeof rewrite) => void } }) {
			server.middlewares.use(rewrite);
		},
		configurePreviewServer(server: { middlewares: { use: (fn: typeof rewrite) => void } }) {
			server.middlewares.use(rewrite);
		},
	};
}

export default defineConfig({
	site: 'https://rivus.ai',
	trailingSlash: 'never',
	integrations: [react()],
	server: { port: 3000 },
	build: { format: 'directory' },
	vite: {
		plugins: [customerJoinRewrite()],
		ssr: {
			// @rivus/core is TypeScript source, so Vite must bundle it.
			noExternal: ['@rivus/core'],
		},
	},
});

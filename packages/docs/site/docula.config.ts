import type { DoculaOptions } from 'docula';

export const options: Partial<DoculaOptions> = {
	output: './dist',
	sitePath: './site',
	// Only enabled when a token is present (e.g. CI), so the build stays green
	// offline. With a token, Docula pulls contributors and repo metadata.
	githubPath: process.env.GITHUB_TOKEN ? 'jaredwray/rivus' : undefined,
	siteTitle: 'Rivus',
	siteDescription: 'Documentation, changelog, and API reference for Rivus.',
	// Where the docs actually deploy (see DEPLOYMENT.md). This is the canonical
	// origin for generated links — sitemap, llms.txt, canonical tags — so it has
	// to match the production custom domain in ../wrangler.jsonc.
	siteUrl: 'https://docs.rivus.ai',
	// Skip the README-driven landing page and make the docs the home page, so
	// visitors land straight on the documentation (Getting Started) at "/".
	autoReadme: false,
	// Rendered as the interactive API reference from the @rivus/api OpenAPI spec.
	openApiUrl: [{ name: 'Rivus API', url: '/openapi.json' }],
	// File-based changelog entries live in site/changelog. Flip this on once the
	// repository publishes GitHub Releases to merge them in automatically.
	enableReleaseChangelog: false,
	enableLlmsTxt: true,
};

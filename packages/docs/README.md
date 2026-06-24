# @rivus/docs

The Rivus documentation site, built with [Docula](https://docula.org). It
publishes three things:

- **Docs** — Markdown pages in `site/docs/`.
- **Changelog** — file-based entries in `site/changelog/`.
- **API reference** — generated from `@rivus/api`'s OpenAPI document.

The API reference is driven by `site/openapi.json`, which is synced from
`packages/api/openapi.json` by `scripts/sync-openapi.mjs` on every build. To
refresh it from the live API route schemas:

```bash
pnpm --filter @rivus/api openapi   # regenerate packages/api/openapi.json
pnpm --filter @rivus/docs build    # syncs the spec and rebuilds the site
```

## Scripts

```bash
pnpm --filter @rivus/docs dev      # watch + serve locally
pnpm --filter @rivus/docs build    # static build into site/dist
```

Branding lives in `site/logo.svg` (the header/sidebar logo used by the theme),
`site/favicon.ico`, and `site/logo.png` (a raster fallback). The logo is the
official Rivus mark; `logo.svg` adapts its wordmark to light/dark mode via a
`prefers-color-scheme` rule, while the symbol keeps its gradient. Site metadata
— including `autoReadme: false`, which makes the docs the landing page — lives
in `site/docula.config.ts`.

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

Branding lives in `site/logo.png` and `site/favicon.ico` — replace the
placeholders with real Rivus artwork. Site metadata is in `site/docula.config.ts`.

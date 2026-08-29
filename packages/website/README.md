# @rivus/website

The Rivus marketing site, built with [Astro](https://astro.build) and React
islands. It tells the Rivus story — the AI agent that runs a local business's
front office — as a static site, and consumes `@rivus/core` directly as
TypeScript source (Vite bundles it).

## Scripts

```bash
pnpm --filter @rivus/website dev    # astro dev (port 3000)
pnpm --filter @rivus/website test   # vitest (jsdom + Testing Library)
pnpm --filter @rivus/website build  # astro build → dist/
```

## Structure

- `src/layouts/Layout.astro` — root layout: Montserrat, metadata, favicon, skip link.
- `src/pages/` — Astro file-based routes (one `.astro` file per URL).
- `src/views/` — React page bodies the routes hydrate as islands.
- `src/styles/globals.css` — the design system: tokens, utilities, and every
  section's styles, written desktop-first with mobile overrides.
- `src/components/marketing/` — one component per section (nav, hero, problem,
  how-it-works, features, onboarding, cross-platform, founding customers,
  pricing, CTA, footer) plus the shared `icons.tsx` set.
- `src/lib/site.ts` — all list-shaped content (nav, features, pricing tiers,
  founding benefits, …) in one place, plus `featureAnchor` (built on the
  shared `@rivus/core` `slugify`).
- `src/components/api-status.tsx` — a small client island that pings the API
  and shows a live "all systems operational" indicator in the footer.

The design mirrors the "Rivus Marketing" and "Rivus Marketing Mobile" Claude
Design files; `public/assets/` holds the brand logos used across the page.

## Configuration

`PUBLIC_API_URL` points the footer status indicator at the API (defaults to
`http://localhost:4000`). `PUBLIC_APP_URL` and `PUBLIC_DOCS_URL` are resolved
per `RIVUS_ENV` at build time so a development deploy links to
`dev-app.rivus.ai` / `dev-docs.rivus.ai`.

Per-business join URLs (`/customers/join/<slug>`) are one static page. Cloudflare
200-rewrites the slug onto `/customers/join` (`public/_redirects`); `astro dev`
applies the same rewrite via a Vite plugin.

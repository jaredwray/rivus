# @rivus/website

The Rivus marketing site, built with [Next.js](https://nextjs.org) (App Router)
and React 19. It tells the Rivus story — the AI agent that runs a local
business's front office — as one responsive landing page, and consumes
`@rivus/core` directly as TypeScript source via `transpilePackages`.

## Scripts

```bash
pnpm --filter @rivus/website dev    # next dev
pnpm --filter @rivus/website test   # vitest (jsdom + Testing Library)
pnpm --filter @rivus/website build  # next build
```

## Structure

- `src/app/layout.tsx` — root layout: Montserrat (`next/font`), metadata, favicon.
- `src/app/page.tsx` — composes the landing page from the section components.
- `src/app/globals.css` — the design system: tokens, utilities, and every
  section's styles, written desktop-first with mobile overrides.
- `src/components/marketing/` — one component per section (nav, hero, problem,
  how-it-works, features, onboarding, cross-platform, testimonials, pricing,
  CTA, footer) plus the shared `icons.tsx` set.
- `src/lib/site.ts` — all list-shaped content (nav, features, pricing tiers,
  testimonials, …) in one place, plus `featureAnchor` (built on the shared
  `@rivus/core` `slugify`).
- `src/components/api-status.tsx` — a small client component that pings the API
  and shows a live "all systems operational" indicator in the footer.

The design mirrors the "Rivus Marketing" and "Rivus Marketing Mobile" Claude
Design files; `public/assets/` holds the brand logos used across the page.

## Configuration

`NEXT_PUBLIC_API_URL` points the footer status indicator at the API (defaults to
`http://localhost:4000`).

# @rivus/website

The Rivus marketing site, built with [Next.js](https://nextjs.org) (App Router)
and React 19. It consumes `@rivus/core` directly as TypeScript source via
`transpilePackages`, and includes a small client component that reports the live
status of the Rivus API.

## Scripts

```bash
pnpm --filter @rivus/website dev    # next dev
pnpm --filter @rivus/website test   # vitest (jsdom + Testing Library)
pnpm --filter @rivus/website build  # next build
```

## Configuration

`NEXT_PUBLIC_API_URL` points the site at the API (defaults to
`http://localhost:4000`). Content lives in `src/lib/site.ts`; styling is in
`src/app/globals.css`.

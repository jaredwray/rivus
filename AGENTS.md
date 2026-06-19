# Working in the Rivus monorepo

Guidance for humans and agents contributing to this repository. Keep changes
small, typed, and tested.

## Layout

```
packages/
  core/      # @rivus/core   — shared types, Zod schemas, utilities (tsdown lib)
  api/       # @rivus/api    — Fastify REST API on MongoDB Atlas (Mongoose) + JWT
  website/   # @rivus/website— Next.js 16 marketing site
  worker/    # @rivus/worker — Cloudflare Worker (cron + on-demand tasks)
  docs/      # @rivus/docs   — Docula site (docs, changelog, API reference)
  app/       # @rivus/app    — Expo app (iOS / Android / Web)
```

## Commands

```bash
pnpm install                       # install all workspaces
pnpm lint                          # Biome check (format + lint) for the whole repo
pnpm type-check                    # tsc --noEmit across packages
pnpm test                          # Vitest across packages
pnpm --filter @rivus/<pkg> <script>   # run a single package's script
```

Before committing, the three gates that CI runs must pass locally:
`pnpm lint && pnpm type-check && pnpm test`.

## Conventions

- **TypeScript everywhere**, `strict`. Prefer narrow types; avoid `any`. Treat
  ids as branded types (see `@rivus/core`).
- **Biome** owns lint + format (tabs, single quotes, semicolons). Run
  `pnpm lint:fix` (or `biome check --write`) — do not hand-format. Biome does not
  format YAML or Markdown; keep those tidy by hand.
- **Shared versions live in the pnpm catalog** (`pnpm-workspace.yaml`). For
  `typescript`, `vitest`, `@vitest/coverage-v8`, `@faker-js/faker`, `tsdown`,
  `zod`, and `@biomejs/biome`, depend on `"catalog:"` rather than a literal range.
- **`@rivus/core` is consumed as source** (`workspace:*`; its `main` points at
  `src`). Apps bundle it: tsdown `deps.alwaysBundle`, Next `transpilePackages`,
  Metro/esbuild inline it. There is no build-order dependency on it.

## Adding a dependency (mind the supply-chain gate)

`pnpm-workspace.yaml` enforces `minimumReleaseAge: 10080` (strict): pnpm refuses
any version published in the last 7 days. So:

- Add dependencies with a **range** (`^`/`~`), not an exact pin, so pnpm can pick
  a mature version.
- Never use `pnpm add <pkg>@latest` or `pnpm update --latest` — they can bypass
  the gate.
- If a dependency legitimately needs an install/build script, add its exact name
  to `onlyBuiltDependencies` in `pnpm-workspace.yaml`. Everything else is denied.

## Testing philosophy

Tests are an inventory of failure modes, not a coverage ritual.

- Test what breaks: boundaries (zero/one/max/empty), invalid input, dependency
  failures (timeouts, non-2xx), and regressions — not just the happy path.
- Keep tests **hermetic**. The API is tested via `app.inject` against in-memory
  repositories (no live MongoDB); the worker and app test pure handlers/clients
  with a mocked `fetch`. Use `@faker-js/faker` for incidental data.
- Coverage thresholds are enforced per package in its `vitest.config.ts`. Do not
  lower a threshold to make a change pass.

## Package-specific notes

- **api** — Routes depend on repository interfaces (`repositories/types.ts`).
  Add a feature by extending the interface, both implementations
  (`memory.ts`, `mongo.ts`), and the route. Regenerate the OpenAPI doc with
  `pnpm --filter @rivus/api openapi`.
- **website** — `type-check` runs `next typegen` first; `next-env.d.ts` is
  generated, not committed.
- **docs** — `scripts/sync-openapi.mjs` copies the API spec into the site on
  build. `githubPath` is gated on `GITHUB_TOKEN` so builds stay green offline.
- **worker** — Handler logic is pure and injectable; `src/index.ts` is the only
  Workers-runtime adapter. Build validates with `wrangler deploy --dry-run`.
- **app** — The API client (`src/api`) is RN-free so it is unit-tested under
  Node. Native builds need Expo tooling/devices and are not run in CI.

## Commits & CI

- Conventional commits (`feat(api): …`, `fix(worker): …`, `chore: …`).
- GitHub Actions are pinned to full commit SHAs and default to
  `permissions: contents: read`. CI runs lint, type-check, test (with coverage),
  and build on Node 22 and 24, plus CodeQL.

# Working in the Rivus monorepo

Guidance for humans and agents contributing to this repository. Keep changes
small, typed, and tested.

## Layout

```
packages/
  core/      # @rivus/core   — shared types, Zod schemas, utilities (tsdown lib)
  api/       # @rivus/api    — Fastify REST API on MongoDB Atlas (Mongoose) + JWT
  website/   # @rivus/website— Next.js 16 marketing site
  agent/     # @rivus/agent  — legacy chat Worker, frozen (chat now lives in the API at /v1/chat)
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

## Design system

**[`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) is the single source of truth for all
user-facing visual design.** Always follow it when building or changing any UI —
the marketing site (`website`), the app (`app`), the docs (`docs`), and any other
visible surface (emails, screenshots, marketing artifacts).

- Use the documented **tokens** (color, typography, radius) instead of inventing
  new hex values, font sizes, or one-off styles. The typeface is **Montserrat**
  (weights 400/500/600).
- Reserve the **signature gradient** (`linear-gradient(135deg, #1ebefa, #6e1ec8)`)
  for Rivus-the-agent (primary buttons, AI status, active nav) — never as a page
  or card background.
- Reuse the documented **components** (`BriefingBanner`, `RivusPill`,
  `StatusBadge`, `MetricCard`, `Avatar`, primary/secondary buttons) and match
  their props.
- If you need a value or component the system doesn't cover, **add it to
  `DESIGN_SYSTEM.md` first**, then implement it — don't hard-code a new literal.
- The original interactive reference is `Rivus-Design-System.mhtml` (open in a
  browser); `DESIGN_SYSTEM.md` is the canonical, editable spec.

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
  repositories (no live MongoDB); the app tests pure clients with a mocked
  `fetch`. Use `@faker-js/faker` for incidental data.
- Coverage thresholds are enforced per package in its `vitest.config.ts`. Do not
  lower a threshold to make a change pass.

## Package-specific notes

- **api** — Routes depend on repository interfaces (`repositories/types.ts`).
  Add a feature by extending the interface, both implementations
  (`memory.ts`, `mongo.ts`), and the route. Regenerate the OpenAPI doc with
  `pnpm --filter @rivus/api openapi`.

  The customer-facing agent is **unified across channels** (email, WhatsApp,
  and — later — SMS/voice), and the layering is what keeps it that way:
  - **Core (`src/services/agent/`) owns all behavior** — the pure policy
    (`engine.ts`), availability (`slots.ts`), reply parsing (`parse.ts`), the
    capability registry (`capabilities.ts`), the `AgentDecision → AgentResponse`
    composer (`response.ts`), and the one shared orchestrator
    (`orchestrator.ts`) every channel's inbound route calls.
  - **Channels (`services/agent/<channel>/` + `routes/agent-<channel>.ts`) are
    dumb adapters** — a `ChannelAdapter` (`channel.ts`) does only three
    feature-blind things: normalize an inbound provider payload, generically
    render an `AgentResponse`, and transport. A channel module must **never**
    import `engine.ts`, `capabilities.ts`, or `AgentDecision`; if it needs to,
    the seam is wrong.
  - **Adding a core feature** = a new `AgentCapability` (or a new
    `AgentDecision→AgentResponse` case) composed from the existing
    `AgentResponseBlock` kinds, registered in `defaultCapabilities()`. It ships
    on **every** channel with zero channel edits. Only a genuinely new *block*
    kind touches renderers — and then the compiler (exhaustive switches) and
    `test/agent-response-matrix.test.ts` (channels × decisions) flag every one.
  - **Adding a channel** = a provider seam (sender/inbound-parse/webhook, all
    Noop-able), a `ChannelCapabilities` + one generic renderer, a
    `createXChannelAdapter`, and a thin `routes/agent-x.ts` that resolves the
    account and hands an `InboundAgentMessage` to `handleInboundAgentMessage`.
    Register its adapter in `services/agent/channels.ts` and it inherits inbox
    reply-out automatically. Provider wire details stay behind config +
    `TODO(<provider>)` markers (see `services/zernio-whatsapp.ts`).
- **website** — `type-check` runs `next typegen` first; `next-env.d.ts` is
  generated, not committed. All UI follows [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md).
- **docs** — `scripts/sync-openapi.mjs` copies the API spec into the site on
  build. `githubPath` is gated on `GITHUB_TOKEN` so builds stay green offline.
- **agent** — A Cloudflare Agent (SQLite-backed Durable Object). Reply logic is
  pure (`conversation.ts`, `http.ts`) and unit-tested under Node; `agent.ts` and
  `index.ts` are the Workers-runtime adapters (they import the Agents SDK, which
  needs `cloudflare:workers`, so they aren't unit-tested). Coverage is scoped to
  the pure modules; build validates with `wrangler deploy --dry-run`.
- **app** — The API client (`src/api`) is RN-free so it is unit-tested under
  Node. Native builds need Expo tooling/devices and are not run in CI. All UI
  follows [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md).

## Commits & CI

- Conventional commits (`feat(api): …`, `fix(app): …`, `chore: …`).
- GitHub Actions are pinned to full commit SHAs and default to
  `permissions: contents: read`. CI runs lint, type-check, test (with coverage),
  and build on Node 22 and 24, plus CodeQL.

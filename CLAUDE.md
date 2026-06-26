# CLAUDE.md

This file guides Claude Code (and other agents) when working in this repository.

The full conventions live in **[AGENTS.md](./AGENTS.md)** — read it first. The
essentials:

- pnpm monorepo. Install with `pnpm install`; run a package with
  `pnpm --filter @rivus/<pkg> <script>`.
- Before finishing any change, make these pass:
  `pnpm lint && pnpm type-check && pnpm test`.
- Biome owns formatting (run `pnpm lint:fix`); never hand-format.
- Shared dependency versions come from the pnpm **catalog** (`"catalog:"`).
- A strict 7-day `minimumReleaseAge` gate blocks brand-new dependency versions —
  add deps with `^`/`~` ranges, never `@latest`.
- `@rivus/core` is imported as source; apps bundle it.
- Keep tests hermetic (the API uses in-memory repositories; the app mocks
  `fetch`). Don't lower coverage thresholds to pass.
- All user-facing UI must follow **[DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md)** — use
  its tokens and components, never ad-hoc styles.

Use Conventional Commit messages.

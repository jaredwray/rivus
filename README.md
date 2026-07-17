<p align="center">
  <img src="./logo.webp" alt="Rivus" width="220" />
</p>

<h1 align="center">Rivus</h1>

<p align="center">Ship your product across web, mobile, and the edge — from one typed monorepo.</p>

---

Rivus is a Node.js + TypeScript **monorepo** that bundles everything a product
needs: a REST API, a marketing site, a documentation site, and a cross-platform
app — all sharing one core library and one toolchain.

## Packages

| Package                              | Stack                                   | What it is                                                            |
| ------------------------------------ | --------------------------------------- | -------------------------------------------------------------------- |
| [`@rivus/core`](./packages/core)     | TypeScript, Zod                         | Shared domain types, schemas, and utilities                          |
| [`@rivus/api`](./packages/api)       | Fastify, Mongoose (MongoDB Atlas), JWT  | REST API with an OpenAPI document generated from its route schemas   |
| [`@rivus/website`](./packages/website) | Next.js 16 (App Router), React 19     | Marketing site                                                       |
| [`@rivus/agent`](./packages/agent)   | Cloudflare Agents (Durable Objects)     | Legacy chat Worker, frozen — chat now lives in the API (`/v1/chat`) |
| [`@rivus/docs`](./packages/docs)     | Docula                                  | Docs, changelog, and the API reference                              |
| [`@rivus/app`](./packages/app)       | Expo (iOS / Android / Web)              | Cross-platform client application                                   |

## Toolchain

| Concern            | Tool                                      |
| ------------------ | ----------------------------------------- |
| Package manager    | [pnpm](https://pnpm.io) workspaces + catalog |
| Language           | TypeScript                                |
| Lint & format      | [Biome](https://biomejs.dev)              |
| Tests & coverage   | [Vitest](https://vitest.dev) + v8         |
| Test data          | [`@faker-js/faker`](https://fakerjs.dev)  |
| Library bundling   | [tsdown](https://tsdown.dev)              |
| Local services     | Docker Compose (MongoDB)                  |

## Getting started

Requirements: **Node.js 22+**, **pnpm 10** (`corepack enable`), and **Docker**.

```bash
pnpm install        # install every workspace
pnpm services:up    # start MongoDB (single-node replica set) via docker compose
pnpm dev            # run every package in dev mode
cp .env.example .env
```

Work on one package with a filter:

```bash
pnpm --filter @rivus/api dev
pnpm --filter @rivus/website dev
```

## Workspace scripts

| Command              | What it does                                          |
| -------------------- | ---------------------------------------------------- |
| `pnpm lint`          | Lint & format-check everything with Biome            |
| `pnpm type-check`    | `tsc --noEmit` across packages                       |
| `pnpm test`          | Run every Vitest suite                               |
| `pnpm test:coverage` | Run tests with coverage thresholds enforced          |
| `pnpm build`         | Build every package that has a build                 |
| `pnpm services:up`   | Start local MongoDB                                  |
| `pnpm services:down` | Stop local services                                  |

## How it fits together

- `@rivus/core` is consumed as TypeScript **source** and bundled into each app at
  build time, so there is never a stale compiled copy to rebuild.
- The **API** keeps routes free of database coupling via a repository interface
  (in-memory for tests, Mongoose for production), and its Zod schemas generate
  the OpenAPI document the **docs** site renders as its API reference.
- The **website** and **app** both read `*_PUBLIC_API_URL` to talk to the API.
- The **Rivus chat** (the app's floating launcher) is an API endpoint
  (`POST /v1/chat`) — optionally authenticated, answering from the account's
  company record and knowledge base. The old standalone agent Worker is frozen
  pending retirement (see [AGENT_MIGRATION.md](./AGENT_MIGRATION.md)).

## Supply chain & CI

Following the practices in the companion [`agentic`](https://github.com/jaredwray/agentic)
playbooks:

- A strict 7-day `minimumReleaseAge` gate blocks freshly published versions.
- Dependency install scripts are denied by default (`onlyBuiltDependencies`).
- CI installs with `--frozen-lockfile`, defaults to `permissions: contents: read`,
  and pins every GitHub Action to a full commit SHA.
- CodeQL and a CODEOWNERS-gated review run on every PR; Socket Security scans
  dependencies on the repository.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and our [Code of Conduct](./CODE_OF_CONDUCT.md).
Security issues: please follow [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE) © Jared Wray

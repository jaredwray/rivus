---
title: Architecture
navTitle: Architecture
description: How the Rivus monorepo and its packages fit together.
order: 2
---

# Architecture

## Monorepo layout

```
rivus/
├── packages/
│   ├── core/      # shared types, Zod schemas, utilities
│   ├── api/       # Fastify REST API (MongoDB Atlas)
│   ├── website/   # Next.js marketing site
│   ├── worker/    # Cloudflare Worker
│   ├── docs/      # this site (Docula)
│   └── app/       # Expo app (iOS / Android / Web)
├── docker-compose.yml
└── pnpm-workspace.yaml
```

The repository uses **pnpm workspaces** with a version **catalog** so the whole
tree shares one toolchain version. `@rivus/core` is consumed as TypeScript
source and bundled into each app at build time.

## Tooling

| Concern     | Tool                          |
| ----------- | ----------------------------- |
| Package mgr | pnpm (catalog + workspaces)   |
| Lint/format | Biome                         |
| Tests       | Vitest + v8 coverage          |
| Test data   | `@faker-js/faker`             |
| Library build | tsdown                      |

## API design

The API keeps its routes free of any database coupling: handlers depend on
**repository interfaces**, with an in-memory implementation for tests and a
Mongoose implementation for production. Request and response bodies are validated
by Zod schemas from `@rivus/core`, which also generate the OpenAPI document that
powers the [API reference](/api).

## Supply-chain posture

Installs are gated by a strict 7-day `minimumReleaseAge`, lifecycle build scripts
are denied by default, CI installs with `--frozen-lockfile`, and every GitHub
Action is pinned to a full commit SHA.

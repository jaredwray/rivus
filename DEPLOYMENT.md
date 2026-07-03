# Deployment

Every Rivus package deploys to **Cloudflare** with Wrangler. Two workflows
validate the monorepo, then deploy all four packages in parallel:

- [`Deploy (development)`](.github/workflows/deploy-development.yaml) → the
  `development` environment, on every push to `main` (or manually).
- [`Deploy (production)`](.github/workflows/deploy-production.yaml) → the
  `production` environment, when a **stable release is published** (pre-releases
  are skipped) or manually.

## Topology

| Package          | Cloudflare product                         | Dev URL                     | Prod URL          |
| ---------------- | ------------------------------------------ | --------------------------- | ----------------- |
| `@rivus/api`     | Worker + **Container** (Fastify on Node)   | `dev-api.rivus.ai`          | `api.rivus.ai`    |
| `@rivus/app`     | Worker **Static Assets** (Expo web export) | `dev-app.rivus.ai`          | `app.rivus.ai`    |
| `@rivus/website` | Worker via **OpenNext** (Next.js)          | `dev.rivus.ai`              | `rivus.ai`        |
| `@rivus/docs`    | Worker **Static Assets** (Docula build)    | `dev-docs.rivus.ai`         | `docs.rivus.ai`   |
| `@rivus/agent`   | Worker + **Agent** (Durable Object)        | `dev-agent.rivus.ai`        | `agent.rivus.ai`  |

Each package owns a `wrangler.jsonc` with `development` and `production` named
environments (`wrangler deploy --env <name>`). Development names are suffixed
`-dev` (`rivus-api-dev`, …); production uses the bare names (`rivus-api`, …) so
the two environments never collide.

### How the API runs on Cloudflare

The API is Fastify + Mongoose on Node — it can't run on the Workers runtime, so
it ships as a **Cloudflare Container**:

- `packages/api/Dockerfile` builds the workspace and runs `node dist/index.mjs`
  (listening on `0.0.0.0:4000`). `wrangler deploy` builds and pushes this image
  automatically; the build context is the monorepo root (`image_build_context`).
- `packages/api/worker/index.ts` is a tiny front-door Worker. `ApiContainer`
  (a SQLite-backed Durable Object) is the handle to the container; the Worker
  forwards every request to it and injects `MONGODB_URI` / `JWT_SECRET` /
  `CORS_ORIGIN` into the container's environment.
- Requires the **Workers Paid plan** (containers are not on the free plan) and a
  local Docker engine when deploying from a workstation.

## Search engine crawling

Only **production** is crawlable. Every pre-production deployment — the
`development` environment (`dev.rivus.ai`, `dev-docs.rivus.ai`,
`dev-app.rivus.ai`) and local builds — blocks all crawlers so it never lands in
a search index.

The signal is a single build-time variable, **`RIVUS_ENV`**, set per environment
in the deploy workflows (`development` vs `production`). Anything other than
`production` — including unset — is treated as non-production, so the safe
default is "don't crawl":

| Package          | Crawl rule emitted                                             |
| ---------------- | ------------------------------------------------------------- |
| `@rivus/website` | `src/app/robots.ts` builds `/robots.txt`; the root layout also adds a `noindex, nofollow` meta tag outside production. |
| `@rivus/docs`    | `scripts/write-robots.mjs` writes `site/dist/robots.txt` after the Docula build. |
| `@rivus/app`     | `scripts/write-robots.mjs` writes `dist/robots.txt` after the Expo web export. |

Production emits an explicit allow-all `robots.txt`; development emits
`User-agent: * / Disallow: /`. The API (`api.rivus.ai`) serves only JSON with no
crawlable UI in any environment (its Swagger UI is off under `NODE_ENV=production`,
which is how the container always runs), so it does not emit a `robots.txt`.

## Staff account seeder

`RIVUS_ENV` has a second consumer: the staff-only account seeder (`POST
/v1/admin/seed`, surfaced as "Developer · seed account" in the app's Settings).
It fills the *current* account with demo data so Rivus staff can populate a fresh
test account from the UI. Because both deployed containers run
`NODE_ENV=production`, `RIVUS_ENV` is the only thing that tells the development
deployment apart from production:

| Side  | How it reads `RIVUS_ENV`                                                   | Result |
| ----- | ------------------------------------------------------------------------- | ------ |
| API   | a `vars` entry in `packages/api/wrangler.jsonc` per environment, forwarded into the container by `worker/index.ts` | Registers the route only when `RIVUS_ENV=development` (or a local `NODE_ENV=development`). Production sets `RIVUS_ENV=production`, so the route 404s there. |
| App   | the deploy workflows bake `EXPO_PUBLIC_RIVUS_ENV` into the Expo bundle     | The Settings card renders only when `EXPO_PUBLIC_RIVUS_ENV=development` (or a local dev build), and only for Rivus-staff (`@rivus.ai`) sessions. |

The gate is an allowlist on both sides — it enables on an explicit
`development`, so an unset or unexpected value in production fails safe (off).
The route is always additionally guarded by `requireStaff`.

## One-time setup

1. **Cloudflare account + zone.** Add the `rivus.ai` zone to the account so the
   `custom_domain` routes can be created and certificates issued automatically.
2. **GitHub environments** (Settings → Environments): a `development` and a
   `production` environment, each holding the secrets below. Consider adding a
   required-reviewer protection rule to `production`.
3. **DNS / custom domains.** The first `wrangler deploy --env <name>` per package
   creates its custom domain on the zone (`dev-*.rivus.ai` for development;
   `api/app/docs.rivus.ai` plus the apex `rivus.ai` and `www.rivus.ai` for
   production). The website serves both `rivus.ai` (primary) and
   `www.rivus.ai`; a Cloudflare redirect rule points www → apex.
4. **MongoDB Atlas.** Allow Cloudflare egress to each cluster (for a quick start,
   allow `0.0.0.0/0`; tighten later). Use a **separate cluster/database** for
   production.

### Required secrets (GitHub `development` environment)

| Secret                  | Used by        | Notes                                              |
| ----------------------- | -------------- | -------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | all deploy jobs | Scopes: Workers Scripts, Workers Routes, Workers KV/DO, Cloudflare Images/Containers (for the API), and DNS/Zone edit for custom domains. |
| `CLOUDFLARE_ACCOUNT_ID` | all deploy jobs |                                                    |
| `DEV_MONGODB_URI`       | `deploy-api`   | Atlas SRV connection string. Pushed as a Worker secret. |
| `DEV_JWT_SECRET`        | `deploy-api`   | ≥ 32 chars (the API refuses to boot otherwise in prod). |

### Required secrets (GitHub `production` environment)

| Secret                  | Used by        | Notes                                              |
| ----------------------- | -------------- | -------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | all deploy jobs | Same scopes as above. Can be the same token as development, or a separate production-scoped one. |
| `CLOUDFLARE_ACCOUNT_ID` | all deploy jobs | Same account ID (unless production lives in a different Cloudflare account). |
| `PROD_MONGODB_URI`      | `deploy-api`   | Production Atlas SRV connection string. Pushed as a Worker secret. |
| `PROD_JWT_SECRET`       | `deploy-api`   | ≥ 32 chars, **distinct** from the development secret. |

Because GitHub environment secrets are scoped to their environment, the
production job reads its own `CLOUDFLARE_*` values even though the names match
development, and the API's secrets are synced into the Worker automatically by
the `deploy-api` job. Unlike development (where the sync is skipped until the
secret exists), the **production** `deploy-api` job **fails fast** if either
`PROD_MONGODB_URI` or `PROD_JWT_SECRET` is missing — the container always boots
with `NODE_ENV=production` and would crash-loop without them.

### Optional secrets (AI knowledge-base features)

| Secret                 | Environment | Notes                                                     |
| ---------------------- | ----------- | --------------------------------------------------------- |
| `DEV_OPENAI_API_KEY`   | development | OpenAI key for the knowledge-base AI features (duplicate check, question answering, and embedding retrieval). Pushed as the `OPENAI_API_KEY` Worker secret by `deploy-api`. |
| `PROD_OPENAI_API_KEY`  | production  | Same, for production. |
| `DEV_RESEND_WEBHOOK_SECRET`  | development | Svix signing secret for Resend's inbound-email webhook. Pushed as the `RESEND_WEBHOOK_SECRET` Worker secret by `deploy-api`, enabling the agent email scheduling channel (`POST /v1/channels/email/inbound`). |
| `PROD_RESEND_WEBHOOK_SECRET` | production  | Same, for production. |

These are **optional**: the `deploy-api` job pushes `OPENAI_API_KEY` only when the
secret is set. With no key, the "is this a duplicate?" check no-ops (FAQs are still
created normally) and question-answering degrades to a deterministic keyword match.

`RESEND_WEBHOOK_SECRET` is likewise pushed only when set. It's the signing secret
of the Resend `email.received` webhook (Resend → Webhooks); without it the agent
email scheduling channel stays off — the webhook route answers `503` in production
while the rest of the API runs normally. Configure the receiving domain (default
`riv.us`, overridable via the `AGENT_EMAIL_DOMAIN` var) and the webhook in Resend
first, then add this secret so `/v1/channels/email/inbound` goes live on the next
deploy. The self-signup link domain (`WEBSITE_URL`) is a non-sensitive `vars` entry
in `packages/api/wrangler.jsonc` (dev → `dev.rivus.ai`, prod → `rivus.ai`).
The chat model defaults to `gpt-5.4-mini` and the embedding model (used to rank FAQs
by relevance once a knowledge base outgrows the answerer's candidate cap) to
`text-embedding-3-small`; since model ids aren't sensitive, override them — if needed —
by adding `OPENAI_MODEL` / `OPENAI_EMBEDDING_MODEL` to the relevant environment's
`vars` in `packages/api/wrangler.jsonc` rather than as secrets.

The production API also restricts CORS to Rivus origins: `CORS_ORIGIN` is set to
`https://rivus.ai,*.rivus.ai`, which the API parses into the exact apex origin
plus a regex matching any `*.rivus.ai` subdomain. The deployed development
environment uses `*.rivus.ai` (which covers `dev-app.rivus.ai`) — both containers
run `NODE_ENV=production`, and the API refuses to boot with a `*` wildcard there
because credentialed CORS reflects the request origin, so a wildcard would
authorize every site. Only local development (`NODE_ENV=development`) stays `*`.
The value accepts a comma-separated list of exact origins and/or `*` wildcards;
adjust it in `packages/api/wrangler.jsonc`.

## Deploying by hand

Swap `--env development` for `--env production` (and the matching API URLs) to
target production.

```bash
pnpm --filter @rivus/agent   exec wrangler deploy --env development
pnpm --filter @rivus/docs    build && pnpm --filter @rivus/docs exec wrangler deploy --env development
EXPO_PUBLIC_API_URL=https://dev-api.rivus.ai EXPO_PUBLIC_AGENT_URL=https://dev-agent.rivus.ai \
  pnpm --filter @rivus/app export:web && \
  pnpm --filter @rivus/app exec wrangler deploy --env development
NEXT_PUBLIC_API_URL=https://dev-api.rivus.ai \
  pnpm --filter @rivus/website exec opennextjs-cloudflare build && \
  pnpm --filter @rivus/website exec opennextjs-cloudflare deploy -- --env development
pnpm --filter @rivus/api     exec wrangler deploy --env development   # needs Docker
```

For production, also push the API secrets the first time (the workflow does this
automatically):

```bash
printf '%s' "$PROD_MONGODB_URI" | pnpm --filter @rivus/api exec wrangler secret put MONGODB_URI --env production
printf '%s' "$PROD_JWT_SECRET"  | pnpm --filter @rivus/api exec wrangler secret put JWT_SECRET  --env production
```

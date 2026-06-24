# Deployment

Every Rivus package deploys to **Cloudflare** with Wrangler. Two workflows
validate the monorepo, then deploy all five packages in parallel:

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
| `@rivus/worker`  | Worker (cron + on-demand tasks)            | cron only (`*.workers.dev`) | cron only         |

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

### How the worker is deployed

`@rivus/worker` is already Cloudflare-native: `wrangler deploy --env development`
bundles `src/index.ts` and registers the `*/15 * * * *` cron. The `development`
environment points `API_BASE_URL` at `https://dev-api.rivus.ai`.

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

The production API also restricts CORS to Rivus origins: `CORS_ORIGIN` is set to
`https://rivus.ai,*.rivus.ai`, which the API parses into the exact apex origin
plus a regex matching any `*.rivus.ai` subdomain (development stays `*`). The
value accepts a comma-separated list of exact origins and/or `*` wildcards;
adjust it in `packages/api/wrangler.jsonc`.

## Deploying by hand

Swap `--env development` for `--env production` (and the matching API URLs) to
target production.

```bash
pnpm --filter @rivus/worker  exec wrangler deploy --env development
pnpm --filter @rivus/docs    build && pnpm --filter @rivus/docs exec wrangler deploy --env development
EXPO_PUBLIC_API_URL=https://dev-api.rivus.ai pnpm --filter @rivus/app export:web && \
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

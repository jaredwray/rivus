# Deployment

Every Rivus package deploys to **Cloudflare** with Wrangler. The
[`Deploy (development)`](.github/workflows/deploy-development.yaml) workflow
validates the monorepo, then deploys all five packages to the `development`
environment in parallel.

## Topology

| Package          | Cloudflare product                         | Dev URL                |
| ---------------- | ------------------------------------------ | ---------------------- |
| `@rivus/api`     | Worker + **Container** (Fastify on Node)   | `dev-api.rivus.ai`     |
| `@rivus/app`     | Worker **Static Assets** (Expo web export) | `dev-app.rivus.ai`     |
| `@rivus/website` | Worker via **OpenNext** (Next.js)          | `dev-www.rivus.ai`     |
| `@rivus/docs`    | Worker **Static Assets** (Docula build)    | `dev-docs.rivus.ai`    |
| `@rivus/worker`  | Worker (cron + on-demand tasks)            | cron only (`*.workers.dev`) |

Each package owns a `wrangler.jsonc` with a `development` named environment
(`wrangler deploy --env development`). Names are suffixed `-dev`
(`rivus-api-dev`, …) so development never collides with production.

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
2. **GitHub `development` environment** (Settings → Environments) holding the
   secrets below.
3. **DNS / custom domains.** The first `wrangler deploy --env development` per
   package creates the `dev-*.rivus.ai` custom domain on the zone.
4. **MongoDB Atlas.** Allow Cloudflare egress to the dev cluster (for a quick
   start, allow `0.0.0.0/0`; tighten later).

### Required secrets (GitHub `development` environment)

| Secret                  | Used by        | Notes                                              |
| ----------------------- | -------------- | -------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | all deploy jobs | Scopes: Workers Scripts, Workers Routes, Workers KV/DO, Cloudflare Images/Containers (for the API), and DNS/Zone edit for custom domains. |
| `CLOUDFLARE_ACCOUNT_ID` | all deploy jobs |                                                    |
| `DEV_MONGODB_URI`       | `deploy-api`   | Atlas SRV connection string. Pushed as a Worker secret. |
| `DEV_JWT_SECRET`        | `deploy-api`   | ≥ 32 chars (the API refuses to boot otherwise in prod). |

The API's secrets are also synced into the Worker automatically by the
`deploy-api` job; the step is skipped until `DEV_MONGODB_URI` is present.

## Deploying by hand

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

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
| `@rivus/website` | Worker **Static Assets** (Astro build)     | `dev.rivus.ai`              | `rivus.ai`        |
| `@rivus/docs`    | Worker **Static Assets** (Docula build)    | `dev-docs.rivus.ai`         | `docs.rivus.ai`   |

The Rivus chat is served by the API (`POST /v1/chat`) — there is no separate
agent service.

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
| `@rivus/website` | `src/pages/robots.txt.ts` builds `/robots.txt`; the root layout also adds a `noindex, nofollow` meta tag outside production. |
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
   `production` environment, each holding the secrets below. Every deploy job
   binds its environment (`environment: production` / `development`), which is
   what lets it read those environment-scoped secrets and what makes a
   protection rule actually gate the deploy — so a required-reviewer rule on
   `production` is worth adding. Repository-level secrets still work as a
   fallback (an environment secret of the same name wins), so the `DEV_*` /
   `PROD_*` names can live at either level.
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
| `DEV_RESEND_API_KEY`    | `deploy-api`   | Auth is passwordless, so the container — which always runs `NODE_ENV=production` — refuses to boot without a real mailer. |

The whole `deploy-api` secret sync is skipped until `DEV_MONGODB_URI` exists, so
a partially configured development environment still deploys.

### Required secrets (GitHub `production` environment)

| Secret                  | Used by        | Notes                                              |
| ----------------------- | -------------- | -------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | all deploy jobs | Same scopes as above. Can be the same token as development, or a separate production-scoped one. |
| `CLOUDFLARE_ACCOUNT_ID` | all deploy jobs | Same account ID (unless production lives in a different Cloudflare account). |
| `PROD_MONGODB_URI`      | `deploy-api`   | Production Atlas SRV connection string. Pushed as a Worker secret. |
| `PROD_JWT_SECRET`       | `deploy-api`   | ≥ 32 chars, **distinct** from the development secret. |
| `PROD_RESEND_API_KEY`   | `deploy-api`   | Required: passwordless auth emails the one-time sign-in code, so the API refuses to boot without it. |

Because the deploy jobs bind `environment: production`, the production run reads
that environment's `CLOUDFLARE_*` values even though the names match
development — put a production-scoped Cloudflare token in the environment and it
takes precedence over any repository-level one. The API's secrets are synced into
the Worker automatically by the `deploy-api` job. Unlike development (where the
sync is skipped until the secret exists), the **production** `deploy-api` job
**fails fast** if `PROD_MONGODB_URI`, `PROD_JWT_SECRET`, or `PROD_RESEND_API_KEY`
is missing — the container always boots with `NODE_ENV=production` and would
crash-loop without them.

### Optional secrets (every integration)

Each of these is named `DEV_<NAME>` in the development environment and
`PROD_<NAME>` in production, and `deploy-api` pushes it to the Worker as
`<NAME>` — **only when it is set**. An unset one never reaches the container as
an empty string (`loadConfig`'s `min(1)` would reject that and crash-loop it), so
leaving a whole integration unconfigured is a supported state: the feature simply
stays off.

Note the sync only ever *adds or updates*. Removing the GitHub secret leaves the
Worker's copy in place — retire an integration with
`wrangler secret delete <NAME> --env <environment>`.

| Worker secret (`DEV_`/`PROD_` prefixed in GitHub) | Enables | Unset behaviour |
| ------------------------------- | -------- | ---------------- |
| `OPENAI_API_KEY`                | Knowledge-base AI: duplicate-FAQ check, question answering, embedding retrieval. The primary AI provider. | Duplicate check no-ops (FAQs still created); answering falls back to a deterministic keyword match. |
| `ANTHROPIC_API_KEY`             | The model-backed chat router (`POST /v1/chat`); also an AI-provider fallback. | Chat routes deterministically (rule-based), which still works. |
| `GOOGLE_GENERATIVE_AI_API_KEY`  | AI-provider fallback; also the embedding provider when OpenAI's key is absent. | Skipped in the provider chain. |
| `XAI_API_KEY`                   | AI-provider fallback. | Skipped in the provider chain. |
| `RESEND_WEBHOOK_SECRET`         | The agent email scheduling channel (`POST /v1/channels/email/inbound`). | Route answers `503` in production; dev/test accept unsigned deliveries. |
| `ZENROWS_API_KEY`               | The chat's website audit (fetches the account's own site). | The audit replies "not enabled". |
| `BRAVE_SEARCH_API_KEY`          | The audit's online-presence check. | Audit still runs; only that check is skipped. |
| `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` | WhatsApp, SMS, and voice — the primary provider for new numbers. The auth token also verifies `X-Twilio-Signature`. | Channels degrade to no-ops (a deterministic fake number in development); the Twilio routes answer `503` in production. |
| `PLIVO_AUTH_ID` + `PLIVO_AUTH_TOKEN` | The numbers Plivo still owns during the Twilio migration. | Plivo-owned numbers can't send; its routes answer `503` in production. |
| `ZERNIO_API_KEY`                | zernio, the WhatsApp-only alternative provider. | WhatsApp falls back to Twilio/Plivo, else a no-op. |
| `ZERNIO_WEBHOOK_SECRET`         | Signature verification on zernio's inbound webhook. | Route answers `503` in production. |
| `ZERNIO_VERIFY_TOKEN`           | The `GET` webhook-registration handshake. | That endpoint `404`s. |

One more, on the app rather than the API:

| Secret                             | Used by      | Notes |
| ---------------------------------- | ------------ | ----- |
| `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`  | `deploy-app` | Signup address autocomplete (Places API New). Inlined into the client bundle, so restrict it by HTTP referrer + API in the Google Cloud console. Unset → the address field is a plain text input (the job logs a warning); set but not inlined → the job **fails**, since a silently dropped key is indistinguishable from an unset one at runtime. Not `DEV_`/`PROD_` prefixed — it is read per environment. |

The non-secret half of these integrations — API base URLs, webhook URLs, number
countries, model ids — lives in `packages/api/wrangler.jsonc` `vars`, per
environment. Both environments' Twilio and Plivo webhook URLs are already set
there; they pin the URL that signature verification recomputes (a rewriting proxy
would otherwise break it), ride along on sends as the delivery-status callback,
and the SMS/voice ones are attached to newly rented numbers at purchase.

`RESEND_WEBHOOK_SECRET` is the signing secret
of the Resend `email.received` webhook (Resend → Webhooks); without it the agent
email scheduling channel stays off — the webhook route answers `503` in production
while the rest of the API runs normally. Configure the receiving domain and the
webhook in Resend first, then add this secret so `/v1/channels/email/inbound` goes
live on the next deploy. The receiving domain is set per environment via the
`AGENT_EMAIL_DOMAIN` `vars` entry in `packages/api/wrangler.jsonc`
(dev → `dev.riv.us`, prod → `riv.us`) so dev traffic never lands in the production
inbox — each must be a receiving (MX) and verified sending domain in Resend. The
self-signup link domain (`WEBSITE_URL`) is likewise a non-sensitive `vars` entry
(dev → `dev.rivus.ai`, prod → `rivus.ai`).
The chat model defaults to `gpt-5.4-mini` and the embedding model (used to rank FAQs
by relevance once a knowledge base outgrows the answerer's candidate cap) to
`text-embedding-3-small`; since model ids aren't sensitive, override them — if needed —
by adding `OPENAI_MODEL` / `OPENAI_EMBEDDING_MODEL` to the relevant environment's
`vars` in `packages/api/wrangler.jsonc` rather than as secrets. A `vars` entry
only takes effect if the name is also in `FORWARDED_VARS`
(`packages/api/worker/env.ts`) — that list is what the front-door Worker copies
into the container's `process.env`, and a test asserts it covers every variable
`loadConfig` reads.

The production API also restricts CORS to the exact Rivus origins that call it
from a browser: `CORS_ORIGIN` is
`https://app.rivus.ai,https://rivus.ai,https://www.rivus.ai` (development uses
`https://dev-app.rivus.ai,https://dev.rivus.ai`). A `*.rivus.ai` wildcard is
deliberately avoided — the session cookie is scoped to the parent domain
(`COOKIE_DOMAIN=.rivus.ai`) so any subdomain a wildcard allowed could read
cookie-authenticated responses. Only the app's own origin (`APP_URL`) is granted
*credentialed* CORS; the other allowlisted origins get plain CORS for public
reads. Both containers run `NODE_ENV=production`, where the API refuses to boot
with a `*` wildcard at all, because credentialed CORS reflects the request origin
and a wildcard would authorize every site. Only local development
(`NODE_ENV=development`) stays `*`. The value accepts a comma-separated list of
exact origins and/or `*` wildcards; adjust it in `packages/api/wrangler.jsonc`.

## Deploying by hand

Swap `--env development` for `--env production` (and the matching API URLs) to
target production.

```bash
pnpm --filter @rivus/docs    build && pnpm --filter @rivus/docs exec wrangler deploy --env development
EXPO_PUBLIC_API_URL=https://dev-api.rivus.ai \
  pnpm --filter @rivus/app export:web && \
  pnpm --filter @rivus/app exec wrangler deploy --env development
PUBLIC_API_URL=https://dev-api.rivus.ai \
  pnpm --filter @rivus/website build && \
  pnpm --filter @rivus/website exec wrangler deploy --env development
pnpm --filter @rivus/api     exec wrangler deploy --env development   # needs Docker
```

For production, also push the API secrets the first time (the workflow does this
automatically):

```bash
printf '%s' "$PROD_MONGODB_URI"   | pnpm --filter @rivus/api exec wrangler secret put MONGODB_URI    --env production
printf '%s' "$PROD_JWT_SECRET"    | pnpm --filter @rivus/api exec wrangler secret put JWT_SECRET     --env production
printf '%s' "$PROD_RESEND_API_KEY" | pnpm --filter @rivus/api exec wrangler secret put RESEND_API_KEY --env production
```

Those three are what the container needs to boot. Any of the optional
integrations above follow the same shape, e.g.:

```bash
printf '%s' "$PROD_TWILIO_AUTH_TOKEN" | pnpm --filter @rivus/api exec wrangler secret put TWILIO_AUTH_TOKEN --env production
```

# Migration plan: retire the Cloudflare Agents SDK — chat agent moves into `@rivus/api` on the AI SDK

Status: **in progress — code landed (PR #126); operational retirement pending** ·
Scope: `@rivus/agent` → `@rivus/api`, plus the app's agent client, CI, and docs

**Implemented:** chat wire schemas in `@rivus/core`; the ported chat services
(`packages/api/src/services/chat/`), shared knowledge helpers
(`services/knowledge.ts`), and the optional-auth `POST /v1/chat` route with its
hermetic test suite; the app now chats through the API client
(`packages/app/src/agent/` deleted, `EXPO_PUBLIC_AGENT_URL` gone); the
`deploy-agent` CI jobs are removed and `deploy-api` now syncs an optional
`ANTHROPIC_API_KEY`; docs updated. **Remaining (ops):** create the
`DEV/PROD_ANTHROPIC_API_KEY` GitHub secrets (copy the value the agent Workers
used); run the adoption window; then Phase 3 steps 2–3 below (retire the frozen
Workers/domains, narrow `COOKIE_DOMAIN`, delete `packages/agent`).

## 1. Context and decision

`@rivus/agent` is the chat agent behind `RivusChat`. Today it is a Cloudflare
Worker built on the **Cloudflare Agents SDK** (`agents`): a SQLite-backed
Durable Object (`RivusAgent`) addressed via the SDK's
`/agents/rivus-agent/:name` routing convention, deployed to
`dev-agent.rivus.ai` / `agent.rivus.ai`. We want off that SDK for **platform
flexibility** — the ability to change hosts without rewriting the agent.

Three options were evaluated:

| Option | Verdict |
| --- | --- |
| **AI SDK only** — no agent framework; serve the existing pure pipeline from our own HTTP endpoint | **Chosen.** Maximum portability (plain HTTP + `ai` runs anywhere), zero new dependencies — the AI SDK already powers `decide.ts` and the API's FAQ AI features. The agentic loop, tools, and streaming are all native AI SDK v6 capabilities when we want them. |
| **eve (Vercel)** — open-source filesystem-first agent framework | Not now. Solid flexibility story (Apache-2.0, AI SDK models, self-hosts via `eve build`/Nitro with an identical HTTP contract), and it would buy managed durable sessions, an observability dashboard, and prebuilt channels — but none of those are in use today, it is a fast-moving 0.x beta (friction with our 7-day `minimumReleaseAge` gate), and its durability/cron/sandbox degrade off-Vercel: trading Cloudflare gravity for softer Vercel gravity. Revisit if the roadmap adds long-running durable agent jobs, scheduled agents, or multi-channel agent surfaces (see appendix). |
| **Status quo** (Agents SDK) | Rejected — inseparable from Durable Objects and Workers; this is the coupling we're removing. |

**Placement decision:** the chat endpoint folds **into `@rivus/api`** as
`POST /v1/chat` rather than remaining a separate service. The agent already
authenticates the same `rivus_session` JWT (shared `JWT_SECRET`) and spends its
life calling the API over HTTP; in-process it uses the API's existing auth,
DI, repositories, and test harness directly. This deletes a deployable
service, a custom domain pair, a credentialed-CORS config, a JWT-sync CI step,
and the `EXPO_PUBLIC_AGENT_URL` seam — the agent then rides wherever the API
rides, which is exactly the flexibility goal.

## 2. Current state (verified)

```
app: RivusChat.tsx → src/agent/client.ts
  POST {messages} + bearer/cookie → ${EXPO_PUBLIC_AGENT_URL}/agents/rivus-agent/default
    packages/agent/src/index.ts  routeAgentRequest()            [Agents SDK]
    packages/agent/src/agent.ts  RivusAgent extends Agent (DO)  [Agents SDK]
      → handleChat (http.ts) → respond (assistant.ts):
          verify HS256 JWT (auth.ts, shared JWT_SECRET)
          pick action   — decide.ts: AI-SDK generateObject router
                          (ANTHROPIC_MODEL, default claude-haiku-4-5);
                          intent.ts: deterministic no-key/model-failure fallback
          execute       — REST calls to @rivus/api with the user's token (api.ts)
          format        — deterministic { reply }
```

Facts that shape the plan:

- **The SDK footprint is two files** (`agent.ts`, `index.ts`) plus
  `wrangler.jsonc` and deps. Everything with behavior
  (`http/conversation/assistant/auth/decide/intent/api.ts`) is pure,
  SDK-free, and unit-tested with injected `fetch`/fake generators.
- **No framework feature is actually used**: the DO state is a vestigial
  `{ messagesSeen }` counter nothing reads; no WebSockets (the app polls
  elsewhere and chat is request/response), no streaming, no scheduling, no
  server-side memory (the client resends full history each turn).
- The action set (zod enum in `decide.ts`): `greeting`, `help`,
  `company_info`, `faq_list`, `faq_search`, `faq_answer`, `faq_create`,
  `faq_update`, `unknown`. Execution is REST calls to `/v1/auth/me` and
  `/v1/faqs*`.
- **Anonymous callers are first-class** (`assistant.ts`): a missing/invalid
  token does not error — signed-out users get the greeting, help, and
  friendly sign-in nudges (protected asks reply with a nudge, not a 401),
  and anonymous turns are routed deterministically (`intent.ts`) so a
  signed-out transcript is never sent to a model and never costs a model
  call. Only signed-in turns use the model router.
- The API (`packages/api`) is plain Fastify assembled by `buildApp(deps)`
  (`src/app.ts`) with DI'd repositories (in-memory for tests, Mongoose in
  prod), `@fastify/jwt` auth (`src/plugins/auth.ts`), a CSRF hook for
  cookie-authenticated writes, zod-typed routes feeding a generated OpenAPI
  spec, and AI SDK services (`services/faq-answer.ts`,
  `services/faq-similarity.ts`).
- Naming caution: `packages/api/src/services/agent/**` is the **channel-policy
  engine** (email/SMS/voice scheduling agent) — unrelated to the Agents SDK
  and untouched by this migration. The ported chat code gets a distinct home
  (`services/chat/`).

## 3. Target architecture

```
app: RivusChat.tsx → existing API client (src/api/client.ts, + chat method)
  POST {messages} → ${EXPO_PUBLIC_API_URL}/v1/chat   (cookie or bearer, as any API call)
    packages/api/src/routes/chat.ts        zod-typed route, optional-auth preHandler
      → services/chat/respond.ts:
          pick action   — services/chat/decide.ts (AI-SDK, injectable via AppDeps)
                          services/chat/intent.ts (deterministic fallback, kept)
          execute       — in-process: same services/repositories the /v1/faqs
                          routes use (FaqRepository, services/faq-answer.ts, …),
                          scoped by the authenticated principal
          format        — deterministic { reply } (ported)
```

- **Wire contract is unchanged** (`{messages}` → `{reply}`), so the chat UX is
  identical. The request/response zod schemas move to `@rivus/core`
  (shared source-of-truth for API and app, per repo convention), and the
  route joins the generated `openapi.json` — the chat API becomes documented
  for free.
- **Auth is optional at the route, enforced at the actions**: the route
  resolves the session when a valid JWT is present (cookie or bearer) but
  does **not** 401 on its absence — anonymous callers must keep getting the
  greeting/help/sign-in-nudge replies they get today. Once a session is
  present, account-scoped actions apply the same membership scoping the
  other `/v1` routes enforce. Anonymous turns also keep today's
  deterministic routing (`intent.ts`), preserving the "signed-out
  transcripts never reach a model" property. The agent's hand-rolled
  `auth.ts` is retired in favor of the API's JWT verification. Web calls
  inherit the API client's credentialed-write handling (CSRF); native uses
  bearer, as everywhere else.
- **Execution moves in-process**: instead of HTTP round-trips with a forwarded
  token, actions call the same service/repository code paths the FAQ routes
  use, with the authenticated account/user passed explicitly. Where that
  logic currently lives inline in route handlers, extract it into shared
  helpers rather than duplicating validation/authorization.
- **Fallback behavior is preserved**: no `ANTHROPIC_API_KEY` (or a model
  failure) still degrades to the deterministic `intent.ts` router — local dev
  and tests keep working with no key, exactly as now.
- **Model config**: `ANTHROPIC_API_KEY` already exists in the API's env
  surface; add `ANTHROPIC_MODEL` (default `claude-haiku-4-5`) to the API env
  and `.env.example`.

## 4. Phases

### Phase 1 — Port the agent into the API (additive; nothing removed yet) ✅

1. `@rivus/core`: add the chat wire schemas (`ChatMessage`, `ChatRequest`,
   `ChatReply`) with tests (core holds 100% coverage).
2. `packages/api/src/services/chat/`: port `decide.ts`, `intent.ts`, and the
   reply formatting from `packages/agent/src/assistant.ts` (+ their tests,
   which come over nearly verbatim — fake-generator injection already exists
   in `decide.test.ts`). Wire a `chat` decider into `AppDeps` so tests inject
   a fake and `server.ts` builds the real one from env.
3. Replace the agent's `api.ts` REST calls with in-process execution against
   the FAQ services/repositories, reusing/extracting the route-level logic so
   authorization stays single-sourced.
4. `packages/api/src/routes/chat.ts`: `POST /v1/chat`, zod-typed, with an
   **optional-auth** preHandler (session populated when present, no 401 when
   absent) and membership scoping enforced inside the account-scoped
   actions; register in `app.ts`; regenerate
   `openapi.json` (docs pick it up via `packages/docs/scripts/sync-openapi.mjs`).
5. Route tests via `app.inject()` + in-memory repositories: happy paths per
   action; anonymous paths return greeting/help/nudge replies (never a hard
   401) and never invoke the model; expired-session and foreign-account
   denials; no-key fallback parity.

### Phase 2 — Switch the app ✅

1. Add `chat` to the existing API client (`packages/app/src/api/client.ts`)
   using the core schemas; point `RivusChat.tsx` at it.
2. Delete `packages/app/src/agent/` (config/client + tests); update
   `packages/app/vitest.config.ts` coverage scope (currently includes
   `src/agent/**`); thresholds unchanged.
3. Remove `EXPO_PUBLIC_AGENT_URL` from `.env.example` and the `deploy-app`
   env blocks in `.github/workflows/deploy-{development,production}.yaml`
   (base URL is the existing `EXPO_PUBLIC_API_URL`).

### Phase 3 — Retire the agent service (step 1 ✅; steps 2–3 are ops follow-ups)

1. ✅ Remove the `deploy-agent` jobs (and their `wrangler secret put JWT_SECRET`
   sync steps) from both deploy workflows; drop `deploy-agent` from the
   `record-deployment` `needs` lists. The deployed Workers freeze but keep
   serving old native builds during the adoption window. **Caveat:** the sync
   step was what kept the agent's `JWT_SECRET` matching the API's — if the
   secret rotates during the window, push it to the frozen Workers by hand
   (`wrangler secret put JWT_SECRET --env <environment>` in `packages/agent`),
   or authenticated chat on old builds silently degrades to signed-out replies.
2. After native adoption is confirmed (or immediately, if chat has only ever
   shipped on web): delete the `rivus-agent` / `rivus-agent-dev` Workers, the
   Durable Object namespace (only vestigial state inside), and the
   `dev-agent.rivus.ai` / `agent.rivus.ai` custom domains. Then narrow the
   session cookie: the API sets `COOKIE_DOMAIN=.rivus.ai` solely so the sibling
   agent host received it — remove the var so the cookie goes host-only, and
   expire the old domain-scoped cookie at sign-in so stale copies don't linger
   until natural expiry. Rollback before this point is trivial: the old service
   is untouched and the app can be re-pointed by env var.
3. Delete `packages/agent` from the repo (kept in-tree until step 2 completes,
   solely so the frozen Workers can be redeployed in an emergency); final docs
   sweep removes the legacy notes added in this phase.

### Phase 4 (optional, when wanted) — Grow the agent with the AI SDK

- Swap the one-shot `generateObject` router for a real tool loop:
  AI SDK v6 `generateText`/`streamText` with `tool()` definitions per action
  and step control — same capability eve's tool layer would have provided,
  no framework.
- Streaming replies: `streamText` over SSE from Fastify with `useChat` on
  web; verify Expo native streaming before enabling there.
- Server-side conversation memory, if ever needed, via the existing
  repository pattern (a `ConversationRepository`-style store in Mongo) rather
  than a framework's session runtime.

## 5. Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| In-process execution bypasses route-level authorization | Reuse the same service checks the `/v1/faqs` routes use; extract shared helpers instead of duplicating; explicit per-action tests (anonymous → nudge reply, foreign account → denial) |
| Strict route auth would regress the anonymous experience | Optional-auth route by design (see §3): anonymous greeting/help/nudges and their deterministic no-model routing are preserved and pinned by tests |
| CSRF/CORS regressions when chat moves origins | Chat rides the existing API client conventions (credentialed writes already work app→API); e2e check from the app origin |
| Old native builds have `agent.rivus.ai` + the legacy path baked in | Frozen old Worker keeps serving them through the adoption window; deletion is the last step |
| Reply-parity regressions during the port | Golden-transcript tests: canonical prompts (greeting, help, FAQ hit/miss, unknown) in both signed-in and anonymous variants, asserted against current replies before the port, kept green after |
| API latency budget takes on a model call | Same model call as today minus one HTTP hop; the deterministic fallback also bounds worst-case behavior |
| Coverage thresholds dip as code moves between packages | Tests move with the code (agent's suites port over); per-package thresholds stay untouched per repo policy |

## 6. Verification

- Every phase: `pnpm lint && pnpm type-check && pnpm test` green, coverage
  thresholds unchanged.
- Hermetic route tests: `app.inject()` + in-memory repos + injected fake
  decider (no network, no key — repo test policy).
- Golden parity fixtures as above.
- Local e2e: in-memory API + Expo web via the repo's `verify` Playwright
  skill, driving `RivusChat` end-to-end against `/v1/chat`.
- OpenAPI: regenerate and confirm the docs sync script picks up the chat
  route.
- Deployed smoke per environment: `POST /v1/chat` authenticated with cookie
  and bearer, anonymous (expect a greeting/nudge, not a 401), fallback
  behavior with the key absent (dev), then watch old Worker traffic drain
  before retiring it.

## 7. Out of scope

The rest of the Cloudflare estate (API Worker+Container, app/docs static
Workers, website OpenNext) is unchanged. Post-migration, the agent has no
platform coupling at all — it moves with the API, whose Fastify core is DI'd
and Dockerized and therefore already the most portable piece of the stack.

## Appendix: the eve evaluation (for the record)

[eve](https://eve.dev/) (`eve` on npm, Apache-2.0, beta 0.24.x as of July
2026) is Vercel's filesystem-first agent framework: an agent is an `agent/`
directory (`instructions.md`, `agent.ts` via `defineAgent`, `tools/*.ts` via
`defineTool`+zod, plus `skills/`, `subagents/`, `channels/`, `schedules/`),
compiled into an app exposing durable sessions
(`POST /eve/v1/session`, NDJSON streaming) backed by Vercel Workflows, with
Vercel Sandbox, AI Gateway, and an Agent Runs dashboard on Vercel — and a
documented self-host path (`eve build && eve start`, standard Nitro/Node
output, identical HTTP contract; durability/cron/sandbox/observability then
become your responsibility). Models are AI SDK / AI Gateway strings, so it is
provider-agnostic.

Why it lost to AI-SDK-only *for this codebase, today*: every eve feature our
agent would exercise is hosting for a pipeline we already own as pure,
tested functions; adopting it means a second runtime contract (sessions
API, build pipeline, Workflows-shaped durability) and a fast-churning beta
dependency, when the flexibility goal is best served by owning a plain HTTP
endpoint. It becomes worth revisiting if we want durable long-running agent
sessions, scheduled agent jobs, sandboxed code execution, or prebuilt
channels (e.g. Slack) without building that plumbing — the strangler path
would be: mount the then-existing `services/chat` pipeline behind an eve
channel, then adopt eve-native tools/sessions incrementally.

References: [docs](https://vercel.com/docs/eve) ·
[concepts](https://vercel.com/docs/eve/concepts) ·
[deployment/self-hosting](https://eve.dev/docs/guides/deployment) ·
[client SDK](https://eve.dev/docs/guides/client/overview) ·
[github.com/vercel/eve](https://github.com/vercel/eve)

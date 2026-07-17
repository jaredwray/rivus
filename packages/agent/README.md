# @rivus/agent

> **⚠️ LEGACY — FROZEN.** The Rivus chat moved into `@rivus/api` as
> `POST /v1/chat` (see [AGENT_MIGRATION.md](../../AGENT_MIGRATION.md)); the
> app no longer calls this service and CI no longer deploys it. The deployed
> Workers (`dev-agent.rivus.ai` / `agent.rivus.ai`) stay up only for app builds
> that predate the migration, and this package stays in-tree only so they can
> be redeployed in an emergency until they're retired. Don't add features here —
> the chat's logic now lives in `packages/api/src/services/chat/`.

The Rivus AI agent, built on [Cloudflare Agents](https://developers.cloudflare.com/agents/).
A Cloudflare Agent is a **Durable Object** with conversation state built in, so
each chat is its own addressable, stateful instance rather than a stateless
function call.

It greets anyone who opens it, and — once a request is **authenticated** — it can
answer from the signed-in user's own Rivus account: their company details (e.g.
"what's our website?") and their knowledge base (search, update, and add FAQs).
Any other question is treated as a general ask and answered from the knowledge
base: the agent forwards it to the API's AI-backed `/v1/faqs/answer` endpoint,
which finds the relevant FAQs and composes a grounded reply (so "what's our best
price?" is answered by a differently-worded "cost" FAQ), and cites the source FAQ.

### Deciding what to do (`decide.ts`)

Every turn, the agent first decides **which of those tools the message calls for**,
reading the whole conversation. When an `ANTHROPIC_API_KEY` is configured a model
makes that decision, so it follows context across turns (a bare "what should I
add?" after looking at the FAQs is understood) and tells a *question* from a
*command* ("how do I create an invoice?" is answered from the knowledge base, not
turned into a new FAQ). The model only **routes** — it picks a structured action;
the user-facing reply is still composed by the same small, pure, unit-tested
functions. When no key is set — or a model call fails — routing degrades to the
deterministic, rule-based parser (`intent.ts`), so the agent works (and its tests
run) with no model and no network round-trip. `decide.ts` is the single seam: it's
the one place that turns a conversation into an action.

## Authentication

The agent verifies the **same session JWT that `@rivus/api` issues**, so a user
who is signed in to the Rivus app is recognised automatically. The token arrives
either as an `Authorization: Bearer <jwt>` header (native app) or as the
`rivus_session` HttpOnly cookie (web app). Verification is local (HMAC-SHA256 via
Web Crypto) against the shared `JWT_SECRET`, so an unauthenticated caller gets a
friendly nudge to sign in without any network round-trip.

A valid signature only proves the token is ours and unexpired — it isn't the
authority on live membership or permissions. So for anything that touches data,
the agent **forwards the user's token to the Rivus API** (`RIVUS_API_URL`) and
lets the API enforce tenancy (account scoping) and role permissions exactly as it
does for the app. The agent orchestrates and formats; the API stays the single
source of truth. Any `401`/`403` from the API is turned into a clear sentence.

> **Web + cookies across subdomains.** For the browser to send the cookie to
> `agent.rivus.ai`, the API must scope it to the shared parent domain — set
> `COOKIE_DOMAIN=.rivus.ai` on `@rivus/api`. Native clients use the bearer token
> and need no cookie.

### Configuration

| Binding          | Kind   | Example                | Purpose                                             |
| ---------------- | ------ | ---------------------- | --------------------------------------------------- |
| `JWT_SECRET`     | secret | (match the API)        | Verifies session tokens. `wrangler secret put JWT_SECRET`. |
| `RIVUS_API_URL`  | var    | `https://api.rivus.ai` | The REST API the agent calls on the user's behalf.  |
| `ALLOWED_ORIGINS`| var    | `https://app.rivus.ai` | Credentialed-CORS allowlist (`*` = any, dev only).  |
| `ANTHROPIC_API_KEY` | secret | (a provider key)    | Turns on model routing. Unset → deterministic routing. `wrangler secret put ANTHROPIC_API_KEY`. |
| `ANTHROPIC_MODEL`| var    | `claude-haiku-4-5`     | The routing model (small/fast — it only picks an action). |

`RIVUS_API_URL`, `ALLOWED_ORIGINS` and `ANTHROPIC_MODEL` are set per environment in
`wrangler.jsonc`; `JWT_SECRET` and `ANTHROPIC_API_KEY` are deploy-time secrets
(`JWT_SECRET` must equal the API's). The agent routes deterministically when
`ANTHROPIC_API_KEY` is unset, so it boots and works without a model.

## How it fits together

```
┌──────────────┐   POST /agents/rivus-agent/default   ┌────────────────────────┐
│  @rivus/app  │ ───────────────────────────────────► │      @rivus/agent      │
│ floating     │   { messages: [...] }                │  Worker (src/index.ts) │
│ "Rivus" chat │                                       │          │             │
│              │ ◄─────────────────────────────────── │          ▼             │
└──────────────┘   { reply: "Hello! I'm Rivus 👋" }    │  routeAgentRequest()   │
                                                        │          │             │
                                                        │          ▼             │
                                                        │  RivusAgent (Durable   │
                                                        │  Object) .onRequest    │
                                                        └────────────────────────┘
```

1. The app's floating chat posts the conversation to
   `/agents/rivus-agent/default` (see `@rivus/app`'s `src/agent` client).
2. `src/index.ts` (the Worker entrypoint) answers `/health`, `/`, and CORS
   preflights itself, then hands everything under `/agents/:agent/:name` to the
   Agents SDK's `routeAgentRequest`.
3. The SDK routes the request to the `RivusAgent` Durable Object instance named
   `default` and calls its `onRequest`.
4. `onRequest` records that it saw the message (in the Durable Object's
   persistent state) and delegates to the pure `handleChat`, which replies with
   the greeting.

### Why the URL is `/agents/rivus-agent/default`

The Agents SDK routes on `/agents/<binding>/<instance>`. The Durable Object
binding is named `RivusAgent` (see `wrangler.jsonc`); the SDK kebab-cases that to
`rivus-agent`. `default` is the instance name — the single shared conversation
the app talks to. Point a different instance name at a different conversation and
each gets its own isolated state.

## Source layout

| File                  | Runtime?          | Role                                                          |
| --------------------- | ----------------- | ------------------------------------------------------------ |
| `src/conversation.ts` | pure (Node)       | `replyTo(messages)` — the greeting logic.                    |
| `src/auth.ts`         | pure (Node)       | Extract + verify the session JWT (bearer or cookie, HS256).  |
| `src/intent.ts`       | pure (Node)       | `parseIntent(text)` — deterministic understanding layer.     |
| `src/api.ts`          | pure (Node)       | Rivus API client the agent calls on the user's behalf.       |
| `src/assistant.ts`    | pure (Node)       | `respond()` — verify session → intent → API → formatted reply. |
| `src/http.ts`         | pure (Node)       | Request parsing, CORS, and `handleChat` / `handlePublicRoute`. |
| `src/agent.ts`        | Workers runtime   | `RivusAgent` Durable Object — a thin adapter over the pure modules. |
| `src/index.ts`        | Workers runtime   | Worker entrypoint: health/CORS + `routeAgentRequest`.        |
| `src/types.ts`        | shared            | `Env`, `SessionClaims`, `ChatMessage`, `ChatReply`, agent state. |

The pure modules import nothing from the Agents SDK (which pulls in
`cloudflare:workers`, unavailable under Node), which is what keeps the tests
hermetic — see below.

## Develop & smoke test locally

```bash
# Start the agent on the local Workers runtime (http://localhost:8787).
pnpm --filter @rivus/agent dev
```

Then hit it directly — no app required:

```bash
# Liveness probe.
curl http://localhost:8787/health
# {"status":"ok","agent":"rivus"}

# GET the greeting straight from a browser or curl.
curl http://localhost:8787/agents/rivus-agent/default
# {"reply":"Hello! I'm Rivus, your AI assistant. 👋"}

# POST a conversation, the way the app does. Without a session, Rivus greets and
# nudges you to sign in.
curl -X POST http://localhost:8787/agents/rivus-agent/default \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"hi"}]}'
# {"reply":"Hello! I'm Rivus, your AI assistant. 👋 Sign in to Rivus and I can …"}

# Authenticated: forward a session token (the JWT the API issues) and ask about
# your account. Requires JWT_SECRET (matching the API) and RIVUS_API_URL set.
curl -X POST http://localhost:8787/agents/rivus-agent/default \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $RIVUS_JWT" \
  -d '{"messages":[{"role":"user","content":"what is our website?"}]}'
# {"reply":"Your website is https://acme.example."}
```

To see it end-to-end from the app, run the agent (`pnpm --filter @rivus/agent
dev`) and the app (`pnpm --filter @rivus/app web`) side by side. The app reads
`EXPO_PUBLIC_AGENT_URL` (default `http://localhost:8787`), so the floating
**Rivus** chat in the bottom-right corner talks to your local agent. Open it and
it greets you.

## Testing

Tests are **hermetic** and run under plain Node with Vitest — no `workerd` pool —
matching the rest of the monorepo. We test the pure modules
(`conversation.ts`, `http.ts`) directly; they hold all the behaviour. The Durable
Object/Worker adapters (`agent.ts`, `index.ts`) are validated by the build
(`wrangler deploy --dry-run`) and the local smoke test above, so coverage is
scoped to the pure modules.

```bash
pnpm --filter @rivus/agent test            # vitest run
pnpm --filter @rivus/agent test:coverage   # with coverage thresholds
pnpm --filter @rivus/agent type-check      # tsc --noEmit
```

## Scripts

```bash
pnpm --filter @rivus/agent dev      # wrangler dev (local workerd, port 8787)
pnpm --filter @rivus/agent test     # vitest
pnpm --filter @rivus/agent build    # wrangler dry-run bundle into dist/
pnpm --filter @rivus/agent deploy   # wrangler deploy (needs Cloudflare auth)
```

## Deploy

`wrangler deploy --env <development|production>` ships the Worker and its Durable
Object. The named environments map to `dev-agent.rivus.ai` and `agent.rivus.ai`
(see `wrangler.jsonc`); CI deploys them from `.github/workflows`.

## Extending it

- **Smarter understanding.** `parseIntent` is deterministic on purpose (testable,
  predictable). To make it model-backed, replace just that function — `assistant.ts`
  consumes the same `Intent` shape, and the app and routing don't change.
- **More capabilities.** `assistant.ts` already calls the API for company context
  and FAQ search/update/create; add a new API method in `api.ts` and a branch in
  `respond` to cover more (customers, items, …). Permissions come for free — the
  API enforces them and the agent surfaces any `403`.
- **Memory.** Use the Durable Object's state/SQL (`this.state`, `this.setState`,
  `this.sql`) to remember the conversation. `messagesSeen` is already wired as a
  starting point.
- **Streaming.** For token-by-token replies, switch the app to the Agents SDK's
  WebSocket client (`agents/react`) — the same `/agents/rivus-agent/:name`
  endpoint already supports it.

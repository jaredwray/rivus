# @rivus/agent

The Rivus AI agent, built on [Cloudflare Agents](https://developers.cloudflare.com/agents/).
A Cloudflare Agent is a **Durable Object** with conversation state built in, so
each chat is its own addressable, stateful instance rather than a stateless
function call.

Right now the agent does exactly one thing on purpose: **it says hello.** That is
the first milestone — proof that the app can reach the agent and get a reply all
the way back. The reply logic is a single pure function (`replyTo`), so turning
"hello" into a real model-backed assistant later means changing only that one
place.

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

| File                | Runtime?            | Role                                                          |
| ------------------- | ------------------- | ------------------------------------------------------------ |
| `src/conversation.ts` | pure (Node)       | `replyTo(messages)` — the greeting logic. The heart of the agent. |
| `src/http.ts`         | pure (Node)       | Request parsing, CORS, and `handleChat` / `handlePublicRoute`. |
| `src/agent.ts`        | Workers runtime   | `RivusAgent` Durable Object — a thin adapter over the pure modules. |
| `src/index.ts`        | Workers runtime   | Worker entrypoint: health/CORS + `routeAgentRequest`.        |
| `src/types.ts`        | shared             | `Env`, `ChatMessage`, `ChatReply`, agent state.              |

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

# POST a conversation, the way the app does.
curl -X POST http://localhost:8787/agents/rivus-agent/default \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"hi"}]}'
# {"reply":"Hello! I'm Rivus, your AI assistant. 👋"}
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

When you're ready for the agent to do more than greet:

- Put the real logic in `replyTo` (or call a model from `onRequest` and keep
  `replyTo` as the fallback). The app and the routing don't change.
- Use the Durable Object's state/SQL (`this.state`, `this.setState`, `this.sql`)
  to remember the conversation. `messagesSeen` is already wired as a starting
  point.
- For streaming/token-by-token replies, switch the app to the Agents SDK's
  WebSocket client (`agents/react`) — the same `/agents/rivus-agent/:name`
  endpoint already supports it.

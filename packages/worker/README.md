# @rivus/worker

Rivus background worker, deployed to [Cloudflare Workers](https://workers.cloudflare.com).
It runs tasks two ways:

- **Scheduled** — a cron trigger (`*/15 * * * *`) runs the registered tasks.
- **On demand** — `POST /tasks/:name/run` runs a single task.

The handler logic lives in pure, injectable functions (`router.ts`, `tasks.ts`),
so the whole worker is unit-tested with Vitest — no `workerd` pool required. The
`src/index.ts` adapter wires those functions to the Workers runtime.

## Routes

| Method | Path                  | Description           |
| ------ | --------------------- | --------------------- |
| GET    | `/health`             | Liveness probe        |
| GET    | `/tasks`              | List registered tasks |
| POST   | `/tasks/:name/run`    | Run one task          |

## Scripts

```bash
pnpm --filter @rivus/worker dev    # wrangler dev (local workerd)
pnpm --filter @rivus/worker test   # vitest
pnpm --filter @rivus/worker build  # wrangler dry-run bundle into dist/
pnpm --filter @rivus/worker deploy # wrangler deploy (needs Cloudflare auth)
```

Bindings and the cron schedule are configured in `wrangler.jsonc`.

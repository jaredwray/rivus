# @rivus/api

Rivus REST API — [Fastify](https://fastify.dev) on MongoDB Atlas via
[Mongoose](https://mongoosejs.com), with JWT auth and an OpenAPI document
generated from [Zod](https://zod.dev) route schemas.

## Architecture

Routes depend on **repository interfaces**, not on Mongoose directly:

- `repositories/memory.ts` — in-memory stores used by the test suite and for
  running the API without a database.
- `repositories/mongo.ts` — Mongoose-backed stores used in production.

`buildApp(deps)` wires the Fastify instance from injected dependencies, so the
full HTTP surface is tested with `app.inject` and no live MongoDB.

## Endpoints

| Method | Path                | Auth | Description              |
| ------ | ------------------- | ---- | ------------------------ |
| GET    | `/health`           | —    | Liveness probe           |
| GET    | `/docs`             | —    | Swagger UI (non-prod)    |
| POST   | `/v1/auth/register` | —    | Create an account        |
| POST   | `/v1/auth/login`    | —    | Exchange creds for a JWT |
| GET    | `/v1/auth/me`       | JWT  | Current user             |
| GET    | `/v1/items`         | JWT  | List your items (paged)  |
| POST   | `/v1/items`         | JWT  | Create an item           |
| GET    | `/v1/items/:id`     | JWT  | Fetch one item           |
| PATCH  | `/v1/items/:id`     | JWT  | Update an item           |
| DELETE | `/v1/items/:id`     | JWT  | Delete an item           |

## Scripts

```bash
pnpm --filter @rivus/api dev      # watch-mode dev server (needs MongoDB)
pnpm --filter @rivus/api test     # run the hermetic test suite
pnpm --filter @rivus/api build    # bundle to dist/ with tsdown
pnpm --filter @rivus/api openapi  # regenerate openapi.json for the docs site
```

Start MongoDB locally with `pnpm services:up` from the repo root. Configuration
comes from environment variables — see `.env.example`.

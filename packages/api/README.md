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

## Accounts, members & roles

Signing up creates three records in one Mongo transaction: a **User**, a
business **Account**, and an owner **Membership**. Every user belongs to exactly
one account, and the account owns all of its members' data. The JWT carries the
caller's `accountId` and `role`, and `requireRole(...)` guards enforce it.

Roles, in ascending privilege:

- **Member** — works in the account's data; no member management.
- **Manager** — additionally invites/removes Members and manages roles, but not
  billing or account settings.
- **Owner** — full control: manage all roles, billing, account settings, and
  canceling the account. The last remaining owner can't be removed or demoted.

Members are added via tokenized invites (`POST /v1/members/invites` →
`POST /v1/auth/accept-invite`); the invite token is emailed to the invitee and
also returned to the inviter. An Owner may invite any role (including another
Owner); a Manager may only invite Members.

Billing and account settings are **Owner-only**. Canceling an account is a soft
delete — the row and its data are retained but the account is marked `canceled`,
which locks every session out at authentication time.

Authentication is **passwordless**. Signup and login email a 6-digit one-time
code (`POST /v1/auth/signup` and `/v1/auth/login` return `202 { status:
"code_sent" }`); `POST /v1/auth/verify` exchanges the code for a JWT — and, for a
signup, creates the account on first verification. Codes are single-use, expire
in 10 minutes, and lock after 5 wrong attempts.

## Endpoints

| Method | Path                            | Auth           | Description                          |
| ------ | ------------------------------- | -------------- | ----------------------------------- |
| GET    | `/health`                       | —              | Liveness probe                      |
| GET    | `/ready`                        | —              | Readiness probe                     |
| GET    | `/docs`                         | —              | Swagger UI (non-prod)               |
| POST   | `/v1/auth/signup`               | —              | Begin signup; emails a one-time code |
| POST   | `/v1/auth/login`                | —              | Request a one-time sign-in code     |
| POST   | `/v1/auth/verify`               | —              | Exchange a code for a JWT           |
| POST   | `/v1/auth/accept-invite`        | —              | Accept an invite and join an account |
| GET    | `/v1/auth/me`                   | JWT            | Current user, account, and role     |
| GET    | `/v1/members`                   | JWT            | List members + pending invites      |
| POST   | `/v1/members/invites`           | Owner/Manager  | Invite a teammate (any role / Member) |
| DELETE | `/v1/members/invites/:inviteId` | Owner/Manager  | Revoke a pending invite             |
| PATCH  | `/v1/members/:userId/role`      | Owner          | Change a member's role              |
| DELETE | `/v1/members/:userId`           | Owner/Manager  | Remove a member                     |
| PATCH  | `/v1/account`                   | Owner          | Update account business settings    |
| POST   | `/v1/account/cancel`            | Owner          | Cancel (soft-delete) the account    |
| GET    | `/v1/billing`                   | Owner          | Billing summary (free-plan placeholder) |
| GET    | `/v1/items`                     | JWT            | List your account's items (paged)   |
| POST   | `/v1/items`                     | JWT            | Create an item                      |
| GET    | `/v1/items/:id`                 | JWT            | Fetch one item                      |
| PATCH  | `/v1/items/:id`                 | JWT            | Update an item                      |
| DELETE | `/v1/items/:id`                 | JWT            | Delete an item                      |

## Scripts

```bash
pnpm --filter @rivus/api dev           # watch-mode dev server (needs MongoDB)
pnpm --filter @rivus/api test          # run the hermetic test suite
pnpm --filter @rivus/api build         # bundle to dist/ with tsdown
pnpm --filter @rivus/api openapi       # regenerate openapi.json for the docs site
pnpm --filter @rivus/api seed          # seed an account with demo customers + FAQs
pnpm --filter @rivus/api migrate:roles # rename the legacy team_member role to member
```

Start MongoDB locally with `pnpm services:up` from the repo root. Configuration
comes from environment variables — see `.env.example`.

### Seeding demo data

`seed` fills a single account with realistic demo data so you have something to
look at locally: **20–30 CRM customers** and a library of **10+ common business
FAQs**. It writes through the same repositories and Zod schemas the API uses, so
seeded rows are identical to ones created over HTTP.

Point it at an account by **slug or id** with `--account` (the account must
already exist — sign up first, or grab a slug from the staff company switcher):

```bash
# Seed both customers and FAQs (uses MONGODB_URI, defaulting to the local replica set)
pnpm --filter @rivus/api seed --account acme-co

# Control the counts; pass 0 to skip one kind entirely
pnpm --filter @rivus/api seed -a acme-co --customers 25 --faqs 12
pnpm --filter @rivus/api seed -a acme-co --customers 0        # FAQs only

# Preview without writing, or make a batch reproducible
pnpm --filter @rivus/api seed -a acme-co --dry-run
pnpm --filter @rivus/api seed -a acme-co --seed 42

# Full help
pnpm --filter @rivus/api seed --help
```

Customers are additive (re-running adds more), while FAQs are de-duplicated by
question — so re-running the FAQ seed won't create duplicates. The curated FAQ
text and customer generation live in `src/seed-data.ts` (unit-tested);
`src/seed.ts` is the thin database wrapper.

### Migrations

The third role was renamed from `team_member` to `member`. Existing databases
that predate the rename must run `pnpm --filter @rivus/api migrate:roles` once
(it rewrites `team_member` → `member` in `memberships` and `invites`); it is
idempotent and a no-op on fresh databases.

### Email (Resend)

Invitation **and one-time sign-in codes** are delivered through
[Resend](https://resend.com). Set:

| Variable         | Default                    | Notes                                                                   |
| ---------------- | -------------------------- | ----------------------------------------------------------------------- |
| `RESEND_API_KEY` | _(unset)_                  | **Required in production** — auth is passwordless, so without it the API refuses to boot. In dev it's optional (codes just aren't delivered). |
| `EMAIL_FROM`     | `Rivus <hello@rivus.ai>`   | Sender address; its domain must be verified in Resend.                  |
| `APP_URL`        | `https://app.rivus.ai`     | Base URL used to build the accept-invitation / sign-in links.           |

The API calls Resend's HTTP API directly (no SDK) so the transport stays small
and is testable by injecting a fake `fetch`.

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

- **Team Member** — works in the account's data; no member management.
- **Manager** — additionally invites/removes Team Members.
- **Owner** — full control: manage all roles, billing, deleting the account.
  The last remaining owner can't be removed or demoted.

Members are added via tokenized invites (`POST /v1/members/invites` →
`POST /v1/auth/accept-invite`); the invite token is emailed to the invitee and
also returned to the inviter.

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
| POST   | `/v1/members/invites`           | Owner/Manager  | Invite a Manager or Team Member     |
| DELETE | `/v1/members/invites/:inviteId` | Owner/Manager  | Revoke a pending invite             |
| PATCH  | `/v1/members/:userId/role`      | Owner          | Change a member's role              |
| DELETE | `/v1/members/:userId`           | Owner/Manager  | Remove a member                     |
| GET    | `/v1/items`                     | JWT            | List your account's items (paged)   |
| POST   | `/v1/items`                     | JWT            | Create an item                      |
| GET    | `/v1/items/:id`                 | JWT            | Fetch one item                      |
| PATCH  | `/v1/items/:id`                 | JWT            | Update an item                      |
| DELETE | `/v1/items/:id`                 | JWT            | Delete an item                      |

## Scripts

```bash
pnpm --filter @rivus/api dev      # watch-mode dev server (needs MongoDB)
pnpm --filter @rivus/api test     # run the hermetic test suite
pnpm --filter @rivus/api build    # bundle to dist/ with tsdown
pnpm --filter @rivus/api openapi  # regenerate openapi.json for the docs site
```

Start MongoDB locally with `pnpm services:up` from the repo root. Configuration
comes from environment variables — see `.env.example`.

### Email (Resend)

Invitation emails are delivered through [Resend](https://resend.com). Set:

| Variable         | Default                    | Notes                                                       |
| ---------------- | -------------------------- | ----------------------------------------------------------- |
| `RESEND_API_KEY` | _(unset)_                  | When unset, the API runs but invitation emails aren't sent. |
| `EMAIL_FROM`     | `Rivus <hello@rivus.ai>`   | Sender address; its domain must be verified in Resend.      |
| `APP_URL`        | `https://app.rivus.ai`     | Base URL used to build the accept-invitation link.          |

The API calls Resend's HTTP API directly (no SDK) so the transport stays small
and is testable by injecting a fake `fetch`.

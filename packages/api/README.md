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
| POST   | `/v1/account/channels/:channel/enable`  | Owner  | Enable a channel — provisions a number |
| POST   | `/v1/account/channels/:channel/disable` | Owner  | Disable a channel — retains the number |
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
pnpm --filter @rivus/api seed          # seed an account with demo customers, FAQs, appointments
pnpm --filter @rivus/api migrate:roles # rename the legacy team_member role to member
```

Start MongoDB locally with `pnpm services:up` from the repo root. Configuration
comes from environment variables — see `.env.example`.

### Seeding demo data

`seed` fills a single account with realistic demo data so you have something to
look at locally: **20–30 CRM customers**, a knowledge base of **10+ business
FAQs**, and a calendar of **scheduled appointments** (Jobs linked to the seeded
customers and team members). It writes through the same repositories and Zod
schemas the API uses, so seeded rows are identical to ones created over HTTP.

**AI generation.** When a provider key is configured (`OPENAI_API_KEY`,
`GOOGLE_GENERATIVE_AI_API_KEY`, `XAI_API_KEY`, or `ANTHROPIC_API_KEY` — the same
providers as the FAQ features), the data is generated by AI and tailored to the
account's business (so a plumber gets plumbing FAQs and service appointments).
Without a key, or with `--no-ai`, it falls back to built-in faker/curated
generation. Either way every row is re-validated against the create schemas, and
structural fields (money in integer cents, scheduled times, customer/member
links) are always assembled locally so the model can't emit an invalid row.

Point it at an account by **slug or id** with `--account` (the account must
already exist — sign up first, or grab a slug from the staff company switcher):

```bash
# Seed customers, FAQs, and appointments (uses MONGODB_URI, defaulting to local)
pnpm --filter @rivus/api seed --account acme-co

# Control the counts; pass 0 to skip a kind entirely
pnpm --filter @rivus/api seed -a acme-co --customers 25 --faqs 12 --appointments 20
pnpm --filter @rivus/api seed -a acme-co --customers 0           # FAQs + appointments only

# Force the deterministic (non-AI) generators, optionally reproducibly
pnpm --filter @rivus/api seed -a acme-co --no-ai --seed 42

# Preview the plan without calling AI or writing anything
pnpm --filter @rivus/api seed -a acme-co --dry-run

# Full help
pnpm --filter @rivus/api seed --help
```

Customers and appointments are additive (re-running adds more), while FAQs are
de-duplicated by question — so re-running the FAQ seed won't create duplicates.
The deterministic generation, CLI parsing, and de-duplication live in
`src/seed-data.ts`, and the AI layer in `src/seed-ai.ts` (both unit-tested);
`src/seed.ts` is the thin database wrapper.

The same seeder is also exposed over HTTP as `POST /v1/admin/seed` and surfaced
in the app's Settings as "Developer · seed account". That route is registered
only on a local dev API (`NODE_ENV=development`) or the deployed **development**
environment (`RIVUS_ENV=development`) — never in production — and is gated to
Rivus staff (`@rivus.ai`). See `isSeedingEnabled` in `src/config.ts` and the
deployment note in [DEPLOYMENT.md](../../DEPLOYMENT.md#staff-account-seeder).

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

### Agent email channel (scheduling over email)

Customers of a business can email the business's agent address —
`<account-slug>@riv.us` (the local part also accepts the raw account id) — and
Rivus schedules with them over email: it validates the sender against the
account's customers (unknown senders get a link to the public self-signup view
on the website), offers open calendar slots in the account's timezone, and
books the job (a confirmed, unassigned `Job`) once a time is agreed, keeping
the multi-turn state on an `AgentThread` and mirroring the whole exchange into
the inbox as an `email` conversation.

The same webhook also handles **outbound delivery status**: when a reply Rivus
sent bounces (`email.bounced`) or is marked as spam (`email.complained`), the
conversation is flagged `needs_attention` with an inline note, so it surfaces
in the inbox's "Needs you" filter and a human can reach the customer another
way. (The synchronous send failure — Resend rejecting the request outright — is
already handled inline: the booking is rolled back and the delivery retried.)

Wiring it up:

1. In Resend, add your `AGENT_EMAIL_DOMAIN` as a **receiving** domain (MX records)
   and as a verified sending domain. The deployed environments use separate domains
   so dev traffic never lands in the production inbox — `dev.riv.us` for development
   and `riv.us` for production (set per environment in `packages/api/wrangler.jsonc`).
2. Create a webhook pointing at `POST /v1/channels/email/inbound`, subscribed to
   `email.received` **and** the delivery events `email.bounced` and
   `email.complained`, and set its signing secret as `RESEND_WEBHOOK_SECRET`.
   (All events hit the one endpoint; it branches on the event type.)

| Variable                | Default                 | Notes                                                                    |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------ |
| `AGENT_EMAIL_DOMAIN`    | `riv.us`                | Domain of the per-account agent addresses. Deployed: `dev.riv.us` (dev), `riv.us` (prod). |
| `RESEND_WEBHOOK_SECRET` | _(unset)_               | Svix signing secret (`whsec_…`). Unset: dev/test accept unsigned deliveries; **production refuses the route (503)**. |
| `WEBSITE_URL`           | `https://rivus.ai`      | Base URL for the customer self-signup link (`/customers/join/<slug>`).    |

The webhook only carries metadata, so the email body is fetched back through
Resend's received-emails API (`RESEND_API_KEY`). Local testing needs no key:
a payload that embeds `data.text` is used as-is, so you can drive the whole
flow with `curl` against a dev API. The scheduling policy itself is pure
(`src/services/agent/`): deterministic parsing of replies ("option 2",
"Tuesday at 2pm"), business-hours availability (Mon–Fri 9–5 account-local,
60-minute slots, 24 h notice), and a channel-agnostic decision the email
renderer renders — a new channel reuses everything but the renderer, which is
exactly how the WhatsApp channel below is built.

### WhatsApp channel

The same scheduling agent also answers over **WhatsApp Business**. Rivus assigns
the account a WhatsApp number when an owner enables the channel, then customers
who message that number get the identical experience to email — sender
validation against the account's customers (unknown senders get the self-signup
link), open-slot offers in the account's timezone, booking a confirmed `Job`,
multi-turn state on an `AgentThread`, FAQ drafts, and the exchange mirrored into
the inbox as a `whatsapp` conversation. None of that is re-implemented per
channel — or per provider: each provider route owns only its edges (signature
check and payload shape) and hands a canonical event to the shared dispatch
(`routes/agent-whatsapp-shared.ts`), which resolves the account, applies the
loop/unsupported guards, and calls the same `handleInboundAgentMessage` the
email channel uses. See the "unified across channels" note in
[AGENTS.md](../../AGENTS.md) for the layering.

The inbound webhooks also handle **outbound delivery status**: when a message
Rivus sent fails to reach the customer, the conversation is flagged
`needs_attention` with an inline note, so it surfaces in the inbox's "Needs you"
filter and a human can follow up another way — the same treatment as an email
bounce.

Two providers are wired behind the same seams (`WhatsappSender`,
`ChannelProvisioner`): **Plivo** is the primary — chosen whenever its
credentials are set — and **zernio** the alternative, used when only its key is
set. With neither configured, both degrade to no-ops (a deterministic fake
number in dev, sends dropped), so the whole flow still runs locally with `curl`
and no credentials.

#### Plivo (primary provider)

Plivo fronts SMS, MMS, and WhatsApp through one Messages API and one rented
number, which is why it's the primary: when the SMS and voice channels are
built, the same Plivo account and the same per-account number will carry them.

1. Set `PLIVO_AUTH_ID` + `PLIVO_AUTH_TOKEN` (Console → API keys), and
   `PLIVO_API_URL` if it isn't the default.
2. Point the WhatsApp webhook at `POST /v1/channels/whatsapp/plivo/inbound` in
   the Plivo console. Deliveries are verified with Plivo's V2 signature scheme,
   which signs **URL + nonce with the auth token** (there is no separate webhook
   secret). Set `PLIVO_WEBHOOK_URL` to the exact public URL you configured so a
   rewriting proxy can't break verification; the sender also attaches it to every
   message as the delivery-status callback, which is what feeds the
   `needs_attention` flow above.
3. Numbers: enabling the channel rents a voice+SMS-capable number through
   Plivo's Numbers API. Registering that number to the WhatsApp Business Account
   (Meta's Embedded Signup in the Plivo console) is a one-time step per number
   that Plivo does not yet expose over the API — see `TODO(plivo)` in
   `src/services/plivo-whatsapp.ts`.
4. An account **owner** enables the channel — in the app (Settings → WhatsApp
   Business → On) or via `POST /v1/account/channels/whatsapp/enable`. Rivus
   provisions the number and starts answering; `…/disable` turns it off but
   retains the number, so re-enabling restores the same one. Both are idempotent.

| Variable               | Default                    | Notes                                                                                                                 |
| ---------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `PLIVO_AUTH_ID`        | _(unset)_                  | Plivo account auth ID. Both credentials set ⇒ Plivo is the active WhatsApp provider.                                   |
| `PLIVO_AUTH_TOKEN`     | _(unset)_                  | Plivo auth token — API auth **and** the webhook signing key. Unset: dev/test accept unsigned deliveries; **production refuses the Plivo route (503)**. |
| `PLIVO_API_URL`        | `https://api.plivo.com/v1` | Base URL of Plivo's REST API.                                                                                          |
| `PLIVO_WEBHOOK_URL`    | _(unset)_                  | The public URL of the Plivo WhatsApp webhook route. Pins signature verification behind proxies and rides along on sends as the status callback. Unset: the URL is derived per-request and sends carry no callback. |
| `PLIVO_SMS_WEBHOOK_URL` | _(unset)_                 | The SMS counterpart: public URL of the Plivo SMS webhook route, with the same two roles.                               |
| `PLIVO_NUMBER_COUNTRY` | `US`                       | ISO 3166-1 alpha-2 country whose numbers the provisioner rents.                                                        |

#### zernio (alternative provider)

Used when `ZERNIO_API_KEY` is set and the Plivo credentials are not.

1. Set `ZERNIO_API_KEY` (and `ZERNIO_API_URL` if it isn't the default).
2. In zernio, point an inbound webhook at `POST /v1/channels/whatsapp/inbound` and
   set its signing secret as `ZERNIO_WEBHOOK_SECRET`. Subscribe it to zernio's
   `message.received` (inbound customer messages) and `message.failed` (undelivered
   WhatsApp replies) events — the one endpoint handles both and branches on the
   type. `ZERNIO_VERIFY_TOKEN` applies only if zernio requires a `GET` registration
   handshake (still unconfirmed — the handshake endpoint stays inert, 404, until
   the token is set).
3. Enable the channel exactly as in the Plivo step 4 above.

| Variable                | Default                  | Notes                                                                                                                   |
| ----------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `ZERNIO_API_URL`        | `https://zernio.com/api/v1` | Base URL of the zernio API (per zernio's docs).                                                                     |
| `ZERNIO_API_KEY`        | _(unset)_                | Unset: WhatsApp falls back as described above (Plivo when configured, else the no-ops).                                |
| `ZERNIO_WEBHOOK_SECRET` | _(unset)_                | zernio webhook signing secret; the route verifies the `X-Zernio-Signature` (raw-body HMAC-SHA256) header. Unset: dev/test accept unsigned deliveries; **production refuses the route (503)**. |
| `ZERNIO_VERIFY_TOKEN`   | _(unset)_                | Verify token for the `GET` registration handshake. Unset: that handshake endpoint 404s.                               |

Provisionable channels are **WhatsApp and SMS** (voice is schema-ready but not
yet built), both **text only** (media/location/voice messages get no reply).

> **Note — the zernio provider is not yet fully wired to zernio's live API**
> (the Plivo path above is built against Plivo's documented wire formats). The
> remaining zernio specifics are marked `TODO(zernio)` and confined to two files:
>
> - `src/services/zernio-whatsapp.ts` — send + provision leaf paths/payloads
> - `src/services/agent/whatsapp/inbound.ts` — `parseZernioInbound`, the payload→event mapping
>
> **Resolved** (verified against [zernio's docs](https://docs.zernio.com/webhooks)):
> the webhook signature is now the real scheme — `X-Zernio-Signature` (legacy
> `X-Late-Signature`) = lowercase hex HMAC-SHA256 of the raw body — and the API base
> URL default is `https://zernio.com/api/v1`.
>
> **Still open**, so enabling the channel with a real `ZERNIO_API_KEY` won't work
> end-to-end until reconciled:
>
> - **Inbound payload mapping:** `parseZernioInbound` still expects a canonical
>   `whatsapp.message.received` / `whatsapp.message.failed` shape; zernio's real
>   events are `message.received` / `message.failed` with the message in a nested
>   `message` object whose schema must be mapped in.
> - **Send + provision endpoints:** the leaf paths (`/messages`, `/numbers`) and
>   their payloads are still assumptions, and zernio's WhatsApp model looks like
>   *connect credentials + select a number* rather than *provision a new number* —
>   so `ZernioProvisioner` may need rethinking, not just endpoint tweaks.
>
> Until then, use Plivo (or the no-op path) to exercise the flow end-to-end.

### SMS channel (Plivo)

The same scheduling agent also answers over **SMS**, through the same Plivo
account, adapters, and — when both channels are on — the same number as
WhatsApp. Everything about the WhatsApp channel above applies unchanged: the
shared webhook dispatch, the inbox mirroring (an `sms` conversation), delivery
reports flagging failures, and the no-op degradation without credentials.

1. Same credentials as WhatsApp (`PLIVO_AUTH_ID` + `PLIVO_AUTH_TOKEN`).
2. Point the number's message webhook at `POST /v1/channels/sms/plivo/inbound`
   (in the Plivo console, the application attached to the number) and set
   `PLIVO_SMS_WEBHOOK_URL` to that exact public URL.
3. An owner enables the channel (app: Settings → Text messages, or
   `POST /v1/account/channels/sms/enable`). **If the account already holds a
   Plivo-owned WhatsApp number, SMS adopts that same number** instead of
   renting a second one (and vice versa — whichever channel is enabled first
   rents, the other shares). Numbers Plivo doesn't own (zernio's, dev fakes)
   are never shared.
4. US A2P traffic requires the number to be registered for **10DLC** in the
   Plivo console before carriers accept application-originated texts — a
   one-time compliance step per brand/campaign, like the WABA registration for
   WhatsApp.

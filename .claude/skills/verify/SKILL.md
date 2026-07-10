---
name: verify
description: Run the Rivus stack locally (in-memory API + Expo web) and drive it with Playwright to verify app changes end-to-end.
---

# Verifying app changes end-to-end

Boot the whole stack with no Mongo and no provider credentials, then drive the
web app with Playwright against the pre-installed Chromium.

## 1. API on :4000 — in-memory harness

`packages/api/src/server.ts` requires Mongo, but `buildApp(deps)` doesn't. Write
a scratch script (do NOT commit it) that mirrors `packages/api/test/helpers.ts`:
`createInMemoryRepositories()` + `NoopChannelProvisioner` (mints deterministic
`+1555…` numbers) + noop FAQ/email services, and a mailer that appends
`${to} ${code}` to a `codes.log` file — one-time sign-in codes are otherwise
unreadable. Load config with `NODE_ENV: 'development'`, `CORS_ORIGIN: '*'`, then
`app.listen({ host: '127.0.0.1', port: 4000 })`. Run it with
`cd packages/api && pnpm exec tsx <script>.mts` (absolute-path imports into
`packages/api/src/*.ts` work under tsx).

## 2. App on :8081 — Expo web

```bash
cd packages/app && CI=1 EXPO_NO_TELEMETRY=1 BROWSER=none pnpm exec expo start --web --port 8081
```

- The React Native DevTools (Electron) crash under root is harmless.
- **Metro's file watcher can be dead in containers**: edits made after Metro
  boots may never appear. If a change doesn't show up, restart the Expo server.

## 3. Drive with Playwright

Use `playwright-core` (npm-install it in the scratchpad, not the repo) with
`executablePath: '/opt/pw-browsers/chromium'` and `--no-sandbox`.

- Browse **http://localhost:8081** (not 127.0.0.1): web auth is a SameSite
  session cookie scoped to the API host `localhost:4000`, so the page must be
  same-site with it. And navigate in-app (click the sidebar) — a hard `goto`
  drops the session in this setup.
- Sign up at `/signup` (placeholders: `Cascade Plumbing & Heating`,
  `Marcus Thompson`, `you@business.com` → button `Create account`), read the
  code from `codes.log`, fill placeholder `123456`, `Verify & continue`, then
  wait for the `Good …` greeting.
- A fresh unique email per run avoids colliding with earlier signups.
- One `401` console error before login (the session-restore probe) is normal.

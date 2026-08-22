# Defense in Depth

Tracking against https://github.com/jaredwray/agentic/blob/main/skills/security/defense-in-depth-nodejs/SKILL.md.

Profile: website/app · public

## 1. Security docs
- [ ] `SECURITY.md` present — contact info + "How this repository is secured" summary (PR #153 pending)
- [ ] `DEFENSE_IN_DEPTH.md` present (this file) (PR #153 pending)

## 2. CODEOWNERS and cloud bootstrap
- [ ] `.github/CODEOWNERS` covers `/.github/`, `/.cursor/`, `/.devcontainer/`, `/scripts/` with owners the maintainer names (PR #153 pending)
- [ ] Codespaces and Cursor Cloud Agents bootstrap Aikido Safe Chain via scripts/setup-cloud-environment.sh (--ci shims, frozen lockfile) (PR #153 pending)

## 3. Dependencies (pnpm)
- [x] `packageManager: pnpm@11.3+` pinned in `package.json` — verified 2026-08-22
- [x] 7-day cooldown: `minimumReleaseAge: 10080`, `minimumReleaseAgeStrict: true`, `minimumReleaseAgeIgnoreMissingTime: false`; no first-party `minimumReleaseAgeExclude` — verified 2026-08-22
- [ ] `trustPolicy: no-downgrade`; no first-party `trustPolicyExclude` (PR #153 pending)
- [ ] Lifecycle scripts blocked: `strictDepBuilds: true`, `dangerouslyAllowAllBuilds: false`, `allowBuilds: {}` baseline (PR #153 pending)
- [x] `blockExoticSubdeps: true` — verified 2026-08-22
- [x] Lockfile committed; CI installs with `pnpm install --frozen-lockfile` — verified 2026-08-22
- [x] No `.github/dependabot.yml`; other dependency-update tools (if any) open PRs only — never auto-merge — verified 2026-08-22

## 4. GitHub Actions
- [x] `permissions: contents: read` (or `{}` + per-job grants) on every workflow — verified 2026-08-22
- [x] No `contents: write` except jobs whose purpose is mutating the repo (GitHub Release, Changesets version PR); generated output is a workflow artifact, never committed back from CI — verified 2026-08-22
- [x] Every action pinned to a full commit SHA (`npx actions-up`) — verified 2026-08-22
- [ ] Every job installs Socket Firewall (`SocketDev/action` SHA-pinned, `firewall-version` pinned); `pnpm install` / `npm install` run as `sfw pnpm install` / `sfw npm install`
- [ ] `.github/workflows/check-workflows.yaml` lints workflows with zizmor on every PR
- [ ] `persist-credentials: false` on checkouts that don't push
- [x] No `pull_request_target` on workflows that run untrusted PR code — verified 2026-08-22
- [x] Artifact-publishing workflows disable `actions/setup-node` default caching (`package-manager-cache: false`) to prevent cache poisoning — verified 2026-08-22 (no artifact-publishing / npm publish workflows)
- [x] No npm tokens (or other registry credentials) in Actions secrets — verified 2026-08-22 (no workflow references one; repo does not publish to npm)

## 6. Security tooling
- [x] Aikido runs on every build — verified 2026-08-22 (PR #152: "Aikido Security: check code")
- [x] Socket reviews every PR that changes dependencies — verified 2026-08-22 (PR #152: "Socket Security: Pull Request Alerts" and "Project Report")

## 7. Repository lockdown

The lockdown script is not vendored in this repo. Apply it from the skill copy in `jaredwray/agentic` (do not add `scripts/lockdown-repo.sh` here).

- [ ] `lockdown-repo.sh` applied; `--check` with `--required-checks` and `--allowed-actions` passes (PRs required on the default branch, merges blocked unless required status checks pass, tag ruleset, immutable releases, fork-PR approval (public repos), read-only workflow tokens, Actions allowlist, secret scanning, Dependabot disabled, private vulnerability reporting (public repos))
- [ ] Phishing-resistant 2FA (passkeys / hardware keys) on the GitHub and npm accounts (manual)
- [ ] Recovery codes stored offline in a password manager (manual)

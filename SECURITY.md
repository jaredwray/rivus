# Security Policy

We take security seriously and work to keep this project up to date. If you discover a security vulnerability, please report it **privately** so we can investigate and ship a fix before the issue becomes public.

## Reporting a vulnerability

Please use one of the following private channels — **do not open a public issue, pull request, or discussion** for security concerns:

1. **Preferred:** open a private report via GitHub's [Privately reporting a security vulnerability](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) flow on this repository's **Security** tab.
2. **Email:** send the details to me@jaredwray.com. If the issue is urgent, include `[SECURITY]` in the subject line and we will respond as soon as possible.

When reporting, please include as much of the following as you can:

- A description of the vulnerability and its impact.
- Steps to reproduce, or a proof-of-concept.
- The affected version(s) and platform.
- Any suggested remediation, if you have one.

We will acknowledge receipt, work with you on a coordinated disclosure timeline, and credit you in the advisory once a fix is published unless you ask to remain anonymous.

## Supply-chain posture

This monorepo follows a defense-in-depth posture for its dependency graph and CI:

- pnpm is pinned via `packageManager`, and a 7-day `minimumReleaseAge` gate (strict, fail-closed) blocks freshly published versions.
- Install lifecycle scripts are denied by default; only the packages listed in `onlyBuiltDependencies` may run them.
- CI installs with `--frozen-lockfile`, defaults to `permissions: contents: read`, and pins every GitHub Action to a full commit SHA.
- `.github/CODEOWNERS` requires review on all changes, including workflows and manifests.

## Defense in Depth status

Tracking against https://github.com/jaredwray/agentic/blob/main/skills/security/defense-in-depth-nodejs/SKILL.md.

### 3. Dependency Policy
- [x] Committed lockfile present — verified 2026-08-12
- [x] All GitHub Actions installs use `pnpm install --frozen-lockfile` — verified 2026-08-12
- [x] CI blocks if the lockfile would be modified — verified 2026-08-12 (`--frozen-lockfile` fails on drift)
- [x] Any dependency-update tooling in use runs in controlled-PR mode (never auto-merge) — verified 2026-08-12 (no update tooling configured)
- [ ] New direct dependencies require human review
- [ ] High-risk dependencies (install scripts, native builds, exotic sources, recent ownership changes) require additional review
- [ ] Direct dependencies use narrower version ranges (`~` over `^` where reasonable; exact versions for high-risk tooling)

### 4. pnpm 11 Supply Chain Controls
- [x] `packageManager: pnpm@11.x` pinned in `package.json` — verified 2026-08-12 (pnpm@11.7.0 with integrity hash)
- [x] `minimumReleaseAge: 10080` set in `pnpm-workspace.yaml` — verified 2026-08-12
- [x] `minimumReleaseAgeStrict: true` set — verified 2026-08-12
- [x] `minimumReleaseAgeIgnoreMissingTime: false` set — verified 2026-08-12
- [ ] `blockExoticSubdeps: true` set (PR #151 pending)
- [ ] `strictDepBuilds: true` set
- [x] `dangerouslyAllowAllBuilds: false` confirmed — verified 2026-08-12 (not set anywhere; the pnpm default is false)
- [x] `allowBuilds: {}` baseline set — verified 2026-08-12 (default-deny policy in place; not literally empty: allows `esbuild` and `workerd`, explicitly denies `sharp`, `@mongodb-js/zstd`, `core-js-pure`, `node-liblzma`)
- [x] Approved build scripts maintained as code-reviewed policy — verified 2026-08-12 (commented `allowBuilds` block)
- [x] `pnpm approve-builds` only used during dependency review, never automatically in CI — verified 2026-08-12 (not used in any workflow)

### 5. GitHub Actions Hardening
- [x] Default `permissions: contents: read` on every workflow — verified 2026-08-12 (all 4 workflows)
- [x] `id-token: write` only on the final publish job — verified 2026-08-12 (no workflow requests `id-token`)
- [ ] No npm tokens stored in GitHub Actions secrets (no workflow references one and the repo does not publish to npm — verified 2026-08-12; stored-secret inventory in Settings → Actions needs maintainer confirmation)
- [x] All third-party actions pinned to a full commit SHA — verified 2026-08-12
- [ ] CODEOWNERS in place, listing the maintainer and a shared security contact
- [x] No `pull_request_target` for workflows that check out or execute untrusted PR code — verified 2026-08-12 (not used at all)
- [x] Caches not shared across trust boundaries — verified 2026-08-12 (default GitHub cache isolation; PR-branch caches are not restorable on `main`)
- [ ] Package-manager caching disabled in release builds
- [x] No self-hosted runners on public PR workflows (or just-in-time/ephemeral only) — verified 2026-08-12 (`ubuntu-latest` only)
- [ ] GitHub Actions blocked from creating or approving PRs unless explicitly needed (repo setting — verify in Settings → Actions)
- [ ] Workflow/security scanner runs on every PR touching CI, manifests, lockfiles, release scripts, or security policy

### 8. Security Tooling and Detection
- [x] Aikido runs on every build — verified 2026-08-12 (GitHub App check "Aikido Security: check code" runs on every PR/push; see PR #151 checks)
- [x] Socket.dev integrated as a second detection layer — verified 2026-08-12 (GitHub App checks "Socket Security: Pull Request Alerts" and "Project Report" run on every PR)
- [ ] Socket Gateway in report-only mode (and evaluated for blocking)
- [ ] `deepsec` runs on PRs touching release/dep/CI/auth/crypto/package paths
- [ ] Secret scanning enabled on repo and CI artifacts (repo setting — verify in Settings → Code security)
- [ ] SBOMs generated for releases
- [ ] Monitoring on npm package versions, dist-tags, and package settings
- [ ] Monitoring on GitHub audit events for workflow / tag / secret / environment changes

### 9. Public Transparency
- [ ] Release policy documented in `SECURITY.md`
- [ ] Approved signer identities and key fingerprints published (here and/or on `jaredwray.com`)
- [ ] Release verification instructions published
- [ ] Per-release `release-intent.json` + signature bundle published
- [ ] Final tarball signature bundles + SHA256 digests published as release assets
- [ ] Statement that releases without owner approval are suspicious

### 10. Incident Response
- [ ] Host-compromise procedure documented (rotate, purge caches, deprecate)
- [ ] Credential rotation list documented (npm, GitHub, Google, cloud, SSH, registry, CI)
- [ ] Cache purge procedure documented for confirmed malicious versions
- [ ] Version deprecation procedure documented
- [ ] Incident-notice template documented
- [ ] VM rebuild trigger documented
- [ ] Quarterly release-compromise tabletop scheduled

### Manual / external (maintainer-owned)
- [ ] (1) Phishing-resistant 2FA on npm, GitHub, Google Workspace, email, password manager
- [ ] (1) Hardware security keys / passkeys preferred over SMS/TOTP
- [ ] (1) Dedicated release identity created (e.g. `release@jaredwray.com`)
- [ ] (1) Google Workspace 2SV / security keys enforced for release identity
- [ ] (1) Recovery codes stored offline, recovery procedure documented
- [ ] (1) Inactive npm collaborators / GitHub maintainers removed quarterly
- [ ] (1) npm package setting **Require two-factor authentication and disallow tokens** applied
- [ ] (1) Unused npm automation tokens revoked
- [ ] (2) Isolated coding VMs between companies / project families
- [ ] (2) Release VM separated from general development
- [ ] (2) No shared browser / npm / GitHub / cloud sessions across VMs
- [ ] (2) Release signing keys kept out of normal dev shells
- [ ] (2) No random global npm packages on the release VM
- [ ] (2) Release VM network and credential access restricted
- [ ] (2) VMs rebuilt or rotated after suspicious dependency installs
- [ ] (7) npm org/package ownership intentional; broad owner lists avoided
- [ ] (7) Trusted publishing configured only on hardened release workflows
- [ ] (7) `repository.url` accurate so npm provenance maps to the expected repo
- [ ] (7) Trusted publisher settings audited regularly

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

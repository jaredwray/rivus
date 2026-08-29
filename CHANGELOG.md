# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- `@rivus/website` now ships as a static Astro site (React islands) instead of Next.js / OpenNext.

### Added

- Initial Rivus monorepo scaffold built with pnpm workspaces.
- `@rivus/core` — shared domain types, schemas, and utilities.
- `@rivus/api` — Fastify REST API backed by MongoDB Atlas (Mongoose) with JWT auth.
- `@rivus/website` — Astro marketing site.
- `@rivus/docs` — Docula documentation site (docs, changelog, and API reference).
- `@rivus/app` — Expo (iOS, Android, Web) client application.
- Toolchain: pnpm, Vitest (+ v8 coverage), Biome, tsdown, `@faker-js/faker`.
- Supply-chain hardening, CodeQL, and SHA-pinned CI workflows.
- `docker-compose` for local MongoDB.

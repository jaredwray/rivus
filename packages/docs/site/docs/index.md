---
title: Getting Started
navTitle: Getting Started
description: Set up the Rivus monorepo and run every app locally.
order: 1
---

# Rivus

Rivus is a product platform built as a Node.js + TypeScript monorepo. It is made
of four workspaces:

| Package          | What it is                                               |
| ---------------- | -------------------------------------------------------- |
| `@rivus/api`     | Fastify REST API backed by MongoDB Atlas (Mongoose)      |
| `@rivus/website` | Astro marketing site                                     |
| `@rivus/app`     | Expo client for iOS, Android, and Web                    |
| `@rivus/docs`    | This documentation site (Docula)                         |

They share `@rivus/core`, a small library of domain types, Zod schemas, and
utilities.

## Prerequisites

- **Node.js 22+**
- **pnpm 10** (`corepack enable` picks up the pinned version)
- **Docker** for the local MongoDB service

## Quick start

```bash
pnpm install        # install every workspace
pnpm services:up    # start MongoDB via docker compose
pnpm dev            # run every package in dev mode
```

Run a single package with a filter:

```bash
pnpm --filter @rivus/api dev
```

## Verifying a change

The same three gates run in CI:

```bash
pnpm lint           # Biome
pnpm type-check     # tsc --noEmit across packages
pnpm test           # Vitest across packages
```

# syntax=docker/dockerfile:1
# Container image for @rivus/api. `wrangler deploy` builds this with the monorepo
# root as the build context (see image_build_context in wrangler.jsonc), so all
# COPY paths below are relative to the repository root.

# ---- build: install the workspace and compile the API ----
FROM node:24-slim AS build
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

COPY . .

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
	pnpm install --frozen-lockfile

# tsdown bundles @rivus/core into dist/index.mjs.
RUN pnpm --filter @rivus/api build

# Flatten just this package, with production-only dependencies, into /app.
RUN pnpm --filter @rivus/api deploy --prod --legacy /app

# ---- runtime: Node + the pruned app only ----
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist

# Fastify binds 0.0.0.0:4000 by default (API_HOST/API_PORT); this must match
# `defaultPort` in worker/index.ts.
EXPOSE 4000
CMD ["node", "dist/index.mjs"]

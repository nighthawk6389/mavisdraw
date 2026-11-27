# Targets: `server` (API + collaboration WebSocket) and `web` (static app on nginx).
# Build from the repository root, e.g. `docker build --target server .`

# ── Base stage: install dependencies ──────────────────────
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate
WORKDIR /app

# Every workspace's manifest, so the install matches the lockfile and is
# cached until a dependency changes
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/types/package.json ./packages/types/
COPY packages/math/package.json ./packages/math/
COPY packages/llm/package.json ./packages/llm/
COPY packages/compat/package.json ./packages/compat/
COPY packages/export/package.json ./packages/export/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

# ── Build stage ──────────────────────────────────────────
FROM base AS build

ARG VITE_API_URL=http://localhost:3001
ARG VITE_WS_URL=ws://localhost:3001
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL

COPY turbo.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/ ./apps/

RUN pnpm turbo run build

# ── Server image ─────────────────────────────────────────
FROM node:22-alpine AS server
# postgresql-client: pg_isready, used by scripts/db-init.sh (docker-compose)
RUN apk add --no-cache postgresql-client \
  && corepack enable && corepack prepare pnpm@10.29.3 --activate
WORKDIR /app
# Production config checks apply (the server refuses to start with missing
# or development secrets); docker-compose overrides it for local use
ENV NODE_ENV=production

# Production dependencies only: the server and the workspace packages it
# loads (math is listed because export depends on it)
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/server/package.json ./apps/server/
COPY packages/types/package.json ./packages/types/
COPY packages/math/package.json ./packages/math/
COPY packages/llm/package.json ./packages/llm/
COPY packages/compat/package.json ./packages/compat/
COPY packages/export/package.json ./packages/export/
RUN pnpm install --frozen-lockfile --prod && rm -rf "$(pnpm store path)"

# Built output. The server loads these workspace packages' dist at runtime:
# llm (map serialization, MCP), export/svg-markup (embeds), compat/repo
# (repository analysis, pull request checks)
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/packages/types/dist ./packages/types/dist
COPY --from=build /app/packages/llm/dist ./packages/llm/dist
COPY --from=build /app/packages/export/dist ./packages/export/dist
COPY --from=build /app/packages/compat/dist ./packages/compat/dist
# Migrations, applied by `node apps/server/dist/db/migrate.js`
COPY apps/server/drizzle/ ./apps/server/drizzle/

# Files stay root-owned (read-only for the process); the server writes nothing to disk
USER node
EXPOSE 3001
CMD ["node", "apps/server/dist/index.js"]

# ── Frontend image (nginx) ───────────────────────────────
# Runs nginx as an unprivileged user (nginx.conf listens on 3000)
FROM nginxinc/nginx-unprivileged:alpine AS web
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000

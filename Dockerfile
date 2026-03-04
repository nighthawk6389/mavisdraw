# ── Base stage: install dependencies ──────────────────────
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/types/package.json packages/types/tsconfig.json ./packages/types/
COPY packages/math/package.json packages/math/tsconfig.json ./packages/math/
COPY apps/server/package.json apps/server/tsconfig.json ./apps/server/
COPY apps/web/package.json apps/web/tsconfig.json apps/web/vite.config.ts apps/web/vitest.config.ts apps/web/postcss.config.js apps/web/tailwind.config.ts apps/web/index.html ./apps/web/

RUN pnpm install --frozen-lockfile

# ── Build stage ──────────────────────────────────────────
FROM base AS build

ARG VITE_API_URL=http://localhost:3001
ARG VITE_WS_URL=ws://localhost:3001
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL

COPY packages/ ./packages/
COPY apps/ ./apps/

RUN pnpm turbo run build

# ── Server image ─────────────────────────────────────────
FROM node:22-alpine AS server
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate
RUN apk add --no-cache postgresql-client
WORKDIR /app

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json ./
COPY --from=base /app/pnpm-workspace.yaml ./
COPY --from=base /app/pnpm-lock.yaml ./

# Server package + built output
COPY --from=base /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=base /app/apps/server/package.json ./apps/server/

# Types package (built)
COPY --from=build /app/packages/types/dist ./packages/types/dist
COPY --from=base /app/packages/types/package.json ./packages/types/

# Drizzle config + schema source (needed for db:push and db:seed)
COPY apps/server/drizzle.config.ts ./apps/server/
COPY apps/server/src/db/ ./apps/server/src/db/

EXPOSE 3001
CMD ["node", "apps/server/dist/index.js"]

# ── Frontend image (nginx) ───────────────────────────────
FROM nginx:alpine AS web
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000

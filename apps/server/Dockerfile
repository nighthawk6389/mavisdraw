FROM node:22-alpine AS builder

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/types/package.json packages/types/
COPY packages/llm/package.json packages/llm/
COPY packages/export/package.json packages/export/
COPY packages/math/package.json packages/math/
COPY packages/compat/package.json packages/compat/

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/types/ packages/types/
COPY packages/llm/ packages/llm/
COPY packages/export/ packages/export/
COPY packages/compat/ packages/compat/
COPY apps/server/ apps/server/

# The server and the workspace packages it depends on, in order
RUN pnpm --filter "@mavisdraw/server..." run build

FROM node:22-alpine

RUN corepack enable

WORKDIR /app

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=builder /app/apps/server/package.json apps/server/
COPY --from=builder /app/packages/types/package.json packages/types/
COPY --from=builder /app/packages/llm/package.json packages/llm/
COPY --from=builder /app/packages/export/package.json packages/export/
COPY --from=builder /app/packages/math/package.json packages/math/
COPY --from=builder /app/packages/compat/package.json packages/compat/

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/apps/server/dist apps/server/dist
# Migrations, applied by `node apps/server/dist/db/migrate.js` before start
COPY --from=builder /app/apps/server/drizzle apps/server/drizzle
COPY --from=builder /app/packages/types/src packages/types/src
# Loaded at runtime: map serialization (MCP), SVG rendering (embeds) and the
# repository analyzer (pull request checks)
COPY --from=builder /app/packages/llm/dist packages/llm/dist
COPY --from=builder /app/packages/export/dist packages/export/dist
COPY --from=builder /app/packages/compat/dist packages/compat/dist

EXPOSE 3001

CMD ["node", "apps/server/dist/index.js"]

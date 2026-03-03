FROM node:22-alpine AS builder

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/types/package.json packages/types/

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/types/ packages/types/
COPY apps/server/ apps/server/

RUN pnpm --filter @mavisdraw/server build

FROM node:22-alpine

RUN corepack enable

WORKDIR /app

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=builder /app/apps/server/package.json apps/server/
COPY --from=builder /app/packages/types/package.json packages/types/

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/apps/server/dist apps/server/dist
COPY --from=builder /app/packages/types/src packages/types/src

EXPOSE 3001

CMD ["node", "apps/server/dist/index.js"]

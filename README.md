# MavisDraw

A web-based diagramming application with nested/drill-down diagram support. Double-click shapes to drill into child diagrams while maintaining high-level views.

## Tech Stack

- **Frontend**: React 19 + TypeScript 5.7 + Vite 6
- **Backend**: Fastify 5 + Drizzle ORM + PostgreSQL
- **Collaboration**: Y.js + Hocuspocus (real-time WebSocket sync)
- **State**: Zustand 5
- **Rendering**: HTML Canvas + Rough.js (sketchy hand-drawn style)
- **Styling**: Tailwind CSS 3
- **Monorepo**: pnpm workspaces + Turborepo
- **Testing**: Vitest (unit) + Playwright (e2e)

## Prerequisites

- **Node.js** 22 or later
- **pnpm** 10 or later (`corepack enable` to use the version pinned in `package.json`)

## Getting Started

```bash
# Install dependencies
pnpm install

# Start Postgres (requires Docker)
docker compose up -d postgres

# Start both frontend and backend dev servers
pnpm run dev
# Frontend: http://localhost:3000
# Backend:  http://localhost:3001
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm run dev` | Start all dev servers (frontend :3000, backend :3001) |
| `pnpm run build` | Build all packages for production |
| `pnpm run test` | Run unit tests across all packages |
| `pnpm run lint` | Lint all packages with ESLint |
| `pnpm run typecheck` | Type-check all packages |
| `cd apps/web && pnpm run test:e2e` | Run Playwright e2e tests |
| `cd apps/server && pnpm run db:push` | Push schema to database |
| `cd apps/server && pnpm run db:seed` | Seed database with sample data |

## Project Structure

```
mavisdraw/
├── apps/
│   ├── web/              # React frontend (Vite)
│   │   ├── src/
│   │   │   ├── components/   # UI components (Canvas, Toolbar, Collaboration)
│   │   │   ├── stores/       # Zustand state stores
│   │   │   ├── hooks/        # Custom React hooks
│   │   │   └── services/     # API client layer
│   │   └── e2e/              # Playwright e2e tests
│   └── server/           # Fastify backend API
│       └── src/
│           ├── routes/       # REST API routes (auth, projects, diagrams, sharing)
│           ├── db/           # Drizzle ORM schema + migrations
│           ├── services/     # Business logic (auth, diagrams, sharing)
│           ├── middleware/    # Auth + rate limiting middleware
│           └── ws/           # Hocuspocus WebSocket collaboration server
├── packages/
│   ├── types/            # Shared TypeScript type definitions
│   └── math/             # Geometry & math utilities
├── docker-compose.yml    # Local dev services (Postgres, Redis)
├── .github/workflows/    # CI pipeline (lint, test, build)
└── render.yaml           # Render deployment blueprint
```

## Testing

### Unit Tests

Unit tests use [Vitest](https://vitest.dev/) and cover the math utilities and Zustand stores.

```bash
# Run all unit tests
pnpm run test

# Run tests in watch mode (from a specific package)
cd packages/math && pnpm vitest
cd apps/web && pnpm vitest
```

### E2E Tests

End-to-end tests use [Playwright](https://playwright.dev/) and test the full application in a real browser.

```bash
# Install Playwright browsers (first time only)
npx playwright install --with-deps chromium

# Run e2e tests (starts dev server automatically)
cd apps/web && pnpm run test:e2e

# Run with UI mode for debugging
cd apps/web && npx playwright test --ui
```

## Deployment

MavisDraw is a full-stack application with a React frontend and a Fastify API backend. Deployment requires both services plus a PostgreSQL database.

### Render (recommended)

The included `render.yaml` Blueprint deploys the full stack automatically.

**First-time setup:**

1. Go to [dashboard.render.com](https://dashboard.render.com)
2. Click **New** > **Blueprint**
3. Connect your GitHub repository
4. Render reads `render.yaml` and creates all three resources:
   - **mavisdraw-web** — Static site (frontend)
   - **mavisdraw-api** — Web service (backend)
   - **mavisdraw-db** — PostgreSQL database

Environment variables (`CORS_ORIGIN`, `VITE_API_URL`, `DATABASE_URL`, etc.) are wired automatically between services. `COOKIE_SECRET` and `JWT_SECRET` are auto-generated.

**Manual setup (if not using Blueprint):**

Create three Render resources:

1. **PostgreSQL database** — note the connection string
2. **Web Service** (backend):
   - Build: `pnpm install && pnpm --filter @mavisdraw/types build && pnpm --filter @mavisdraw/server build`
   - Start: `node apps/server/dist/index.js`
   - Set env: `DATABASE_URL`, `CORS_ORIGIN` (frontend URL), `COOKIE_SECRET`, `NODE_ENV=production`
3. **Static Site** (frontend):
   - Build: `pnpm install && pnpm run build`
   - Publish dir: `apps/web/dist`
   - Set env: `VITE_API_URL` (backend URL), `VITE_WS_URL` (backend URL with `wss://`)

## CI/CD

GitHub Actions runs on every push to `main` and on pull requests:

- **Lint** — ESLint across all packages
- **Type Check** — TypeScript compilation check
- **Unit Tests** — Vitest across all packages
- **Build** — Full production build
- **E2E Tests** — Playwright browser tests (after build)

See `.github/workflows/ci.yml` for the full configuration.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `V` | Select tool |
| `H` | Hand (pan) tool |
| `R` | Rectangle |
| `E` | Ellipse |
| `D` | Diamond |
| `L` | Line |
| `A` | Arrow |
| `P` | Freedraw (pen) |
| `T` | Text |
| `Space` | Temporary pan mode |
| `Escape` | Deselect / cancel |
| `Delete` / `Backspace` | Delete selected |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `Ctrl+A` | Select all |

## License

Private — not yet open sourced.

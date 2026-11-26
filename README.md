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
| `cd apps/web && pnpm run test:e2e` | Run Playwright e2e tests (mocked API) |
| `cd apps/web && pnpm run test:e2e:real` | Run e2e tests against the real API + Postgres |
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

`Mod` is ⌘ on macOS and Ctrl elsewhere.

| Key | Action |
|-----|--------|
| `V` / `H` | Select / Hand (pan) tool |
| `R` `E` `D` `L` `A` `P` `T` `O` | Rectangle, Ellipse, Diamond, Line, Arrow, Pen, Text, Portal |
| `Space` (hold) | Temporary pan |
| Mouse wheel / pinch | Zoom (trackpad two-finger scroll pans) |
| Right-drag / right-click | Pan / context menu |
| `Shift+1` / `Shift+2` | Zoom to fit / zoom to selection |
| `Mod+=` `Mod+-` `Mod+0` | Zoom in / out / reset to 100% |
| Arrow keys (`Shift` = 10px) | Nudge selection |
| `Mod+Z` / `Mod+Shift+Z` | Undo / redo (one step per gesture; never undoes collaborators) |
| `Mod+C` `Mod+X` `Mod+V` `Mod+D` | Copy, cut, paste at cursor (works across tabs), duplicate |
| `Shift+Alt+C` | Copy selection as PNG |
| `Mod+]` / `Mod+[` | Bring forward / send backward (`Shift` = to front / back) |
| `Mod+G` / `Mod+Shift+G` | Group / ungroup |
| `Mod+Shift+L` | Lock / unlock |
| `Delete` / `Backspace` | Delete selected (labels go with their shape) |
| `Mod+A` / `Escape` | Select all / deselect |
| `Mod+K` | Search: jump to any shape or diagram at any depth, or run a command |
| `Enter` | Drill into the selected portal, or edit the selected shape's / connector's label |
| `Backspace` (nothing selected) | Zoom back out to the parent diagram |
| Double-click a connector | Add or edit its label ("REST", "publishes"...) |
| `Shift+Alt+T` | Tidy up: auto-layout the diagram (or the selection) along its connections |

### Diagram as code

Paste a Mermaid flowchart (from a README, PR or design doc) straight onto the canvas, or use
**Search → Import from Mermaid…**, or import a `.mmd` file. Every `subgraph` becomes a portal you can
drill into, links that cross subgraphs are drawn between the right portals, and every level is
auto-laid out — a flat README diagram becomes a navigable, multi-level map.

### Working together

- **Every project and nested diagram has a URL** (`/p/:project/d/:diagram`) — paste it in Slack and
  teammates land on the same level.
- **Share links** (`Share` → copy link) add whoever opens them to the project with the chosen role.
- **Live editing** merges per property: one person can move a shape while another recolours it.
  Undo only ever undoes your own changes, and never reverts a property a teammate changed after you.
- **Offline**: edits made without a connection are kept in the browser — even if you close the tab —
  and saved when you're back. If a teammate changed the same shape meanwhile, theirs is kept and
  you're told.
- **Viewers** can pan, zoom, select, copy and drill through every level, but can't change anything
  (enforced on the server too).
- **Comments** (`C`, then click a shape or anywhere): the pin sticks to the shape, `@` mentions a
  teammate and notifies them, and the Comments panel lists threads on every nested level.
  Viewers can comment too.
- **Version history** (`Mod+S`) is shared by everyone on the project. Restoring a version updates
  every open editor live, and the previous state is kept as a backup version. **Compare** shows
  what changed since any version: added, changed and removed shapes are outlined on the canvas, with
  a plain-language list ("Renamed “Auth” → “Auth Service”", "Moved", "Reconnected").

## License

Private — not yet open sourced.

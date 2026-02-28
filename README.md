# MavisDraw

A web-based diagramming application with nested/drill-down diagram support. Double-click shapes to drill into child diagrams while maintaining high-level views.

## Tech Stack

- **Frontend**: React 19 + TypeScript 5.7 + Vite 6
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

# Start the dev server (http://localhost:3000)
pnpm run dev
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm run dev` | Start all dev servers (Vite on port 3000) |
| `pnpm run build` | Build all packages for production |
| `pnpm run test` | Run unit tests across all packages |
| `pnpm run lint` | Lint all packages with ESLint |
| `pnpm run typecheck` | Type-check all packages |
| `cd apps/web && pnpm run test:e2e` | Run Playwright e2e tests |
| `cd apps/web && pnpm run preview` | Preview production build locally |

## Project Structure

```
mavisdraw/
├── apps/
│   └── web/              # React frontend application
│       ├── src/
│       │   ├── components/   # UI components (Canvas, Toolbar)
│       │   ├── stores/       # Zustand state stores
│       │   └── hooks/        # Custom React hooks
│       └── e2e/              # Playwright e2e tests
├── packages/
│   ├── types/            # Shared TypeScript type definitions
│   └── math/             # Geometry & math utilities
├── .github/workflows/    # CI pipeline (lint, test, build)
├── vercel.json           # Vercel deployment config
└── render.yaml           # Render deployment config
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

MavisDraw is a static single-page application. The production build outputs to `apps/web/dist/`.

### Vercel

Vercel is the recommended deployment platform for Vite apps.

**First-time setup:**

1. Install the [Vercel CLI](https://vercel.com/docs/cli): `npm i -g vercel`
2. From the repo root, run: `vercel`
3. Follow the prompts — Vercel will auto-detect the Vite framework
4. The included `vercel.json` configures:
   - Build command: `pnpm run build`
   - Output directory: `apps/web/dist`

**Subsequent deploys:**

```bash
# Preview deployment
vercel

# Production deployment
vercel --prod
```

**Or connect via GitHub:**

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your GitHub repository
3. Vercel reads `vercel.json` automatically — no additional config needed
4. Every push to `main` triggers a production deploy; PRs get preview deploys

### Render

Render supports static site hosting.

**First-time setup:**

1. Go to [dashboard.render.com](https://dashboard.render.com)
2. Click **New** > **Static Site**
3. Connect your GitHub repository
4. Render reads `render.yaml` (Blueprint) automatically, or configure manually:
   - **Build command**: `pnpm install && pnpm run build`
   - **Publish directory**: `apps/web/dist`
   - **Node version**: Set `NODE_VERSION=22` in environment variables

**Using Render Blueprint (recommended):**

The included `render.yaml` defines the service configuration. Render will pick it up automatically when you connect the repo. It configures:

- Static site hosting with SPA rewrite rules
- Cache headers for hashed assets
- Node 22 runtime for the build step

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

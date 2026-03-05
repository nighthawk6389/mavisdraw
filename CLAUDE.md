# CLAUDE.md — Development Guidelines for MavisDraw

## Project Overview

MavisDraw is a web-based diagramming application with nested/drill-down diagram support. It uses a monorepo structure with pnpm workspaces and Turborepo.

## Tech Stack

- **Runtime**: Node.js 22+, pnpm 10+
- **Frontend**: React 19, TypeScript 5.7, Vite 6
- **State Management**: Zustand 5
- **Rendering**: HTML Canvas + Rough.js (sketchy mode)
- **Styling**: Tailwind CSS 3
- **Testing**: Vitest (unit), Playwright (e2e)
- **Linting**: ESLint (flat config)
- **Build Orchestration**: Turborepo

## Common Commands

```bash
pnpm install          # Install all dependencies
pnpm run dev          # Start dev server (port 3000)
pnpm run build        # Build all packages
pnpm run test         # Run unit tests (all packages)
pnpm run lint         # Lint all packages
pnpm run typecheck    # Type-check all packages

# E2E tests (from apps/web)
cd apps/web && pnpm run test:e2e
```

## Project Structure

```
apps/web/           → React frontend (Vite)
apps/server/        → Fastify backend (auth, GitHub, AI agent, collaboration)
packages/types/     → Shared TypeScript type definitions
packages/math/      → Geometry & math utilities
packages/llm/       → LLM-readable diagram serialization/deserialization
```

## Development Rules

### Testing Requirements

- **All new features MUST have unit tests** — write tests alongside the implementation.
- **All UI changes MUST have e2e tests** — add Playwright tests for any visible behavior.
- Before submitting, run and verify:
  1. `pnpm run test` — all unit tests pass
  2. `pnpm run lint` — no lint errors
  3. `pnpm run build` — build succeeds
  4. `cd apps/web && pnpm run test:e2e` — e2e tests pass (for UI changes)

### Code Style

- Follow existing patterns — Zustand stores, canvas rendering architecture.
- Use TypeScript strict mode. No `any` types without justification.
- Prettier is configured (see `.prettierrc`): single quotes, trailing commas, 100 char width.
- Keep components focused — separate rendering logic from state management.

### Architecture Notes

- **Canvas uses dual-layer rendering**: a static canvas for elements and an interactive canvas for selection overlays.
- **InteractionManager** is a state machine handling all mouse/touch interactions.
- **Elements are soft-deleted** (`isDeleted: true`) rather than removed from the store.
- **History** stores pre-mutation snapshots for undo; redo state is captured during undo.

### React & Performance Guidelines

Follow the Vercel agent skills installed in `.agents/skills/`:

- **vercel-react-best-practices** — Re-render optimization, derived state, functional setState, conditional rendering, bundle size, and JS performance patterns. Reference when writing or reviewing any React component.
- **vercel-composition-patterns** — Compound components, avoiding boolean prop proliferation, context-based state management. Reference when designing component APIs or refactoring complex components.
- **web-design-guidelines** — UI/UX design quality standards. Reference when building or modifying user-facing interfaces.

Key rules to always keep in mind:

- **Never call functions that create new objects/arrays inside Zustand selectors** — use `useMemo` with stable store references instead (this caused the React error 185 infinite loop bug).
- **Derive state during render**, not in effects (`rerender-derived-state-no-effect`).
- **Use functional setState** for callbacks that depend on current state (`rerender-functional-setstate`).
- **Defer state reads** to the point of use — don't subscribe to store values only used in callbacks (`rerender-defer-reads`).
- **Use refs for transient values** that change frequently but don't need to trigger re-renders (`rerender-use-ref-transient-values`).

### Backlog Tracking

- If you notice an issue, improvement, or code smell that **can't be addressed in the current task**, add it to `BACKLOG.md` at the project root.
- Categorize entries under the appropriate section (Code Quality, Performance, Architecture, Testing, etc.).
- Include the file path and a brief description of the problem and why it matters.

### Commit Guidelines

- Write clear, concise commit messages describing the "why" not just the "what".
- One logical change per commit.
- Ensure CI passes before merging.

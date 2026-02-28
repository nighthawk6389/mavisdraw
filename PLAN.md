# MavisDraw — Implementation Plan

## Context

MavisDraw is a web-based diagramming application inspired by the best of Excalidraw and Miro, with one key differentiator: **nested/drill-down diagrams**. Users can double-click any shape to enter a child diagram, keeping high-level views clean while preserving full detail at lower levels. This plan establishes a staged roadmap from empty repo to full-featured collaborative diagramming platform.

**Visual mode**: Supports both hand-drawn/sketchy (Rough.js) and clean/polished (native Canvas Path2D) rendering, toggleable per diagram.

**Post-approval action**: Commit this plan as `PLAN.md` to the repo, then begin Stage 1 implementation.

---

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Language** | TypeScript 5.x | Type safety, proven by Excalidraw |
| **Frontend** | React 19 + Vite 6 | Fast HMR, native ESM, modern bundling |
| **Canvas** | HTML5 Canvas + Rough.js + Path2D | Dual-canvas architecture. Sketchy mode (Rough.js) + clean mode (native Path2D). Direct Canvas API gives full control for portal zoom transitions. |
| **State** | Zustand | Selective subscriptions prevent re-render storms, temporal middleware for undo/redo |
| **UI Components** | Tailwind CSS 4 + Radix UI primitives | Tailwind for utility styling, Radix for accessible dropdowns/dialogs |
| **Monorepo** | pnpm workspaces + Turborepo | Fast installs, parallel build caching |
| **Backend** | Node.js + Fastify | Faster than Express, built-in JSON Schema validation, plugin architecture |
| **Database** | PostgreSQL 16 + Drizzle ORM | Relational integrity + JSONB for element data. Drizzle is lightweight and SQL-first. |
| **Real-time** | Y.js + Hocuspocus | CRDT-based sync. Hocuspocus is the production-grade Y.js WebSocket server with built-in auth/persistence hooks. |
| **Auth** | Better Auth (email/password + OAuth) + BoxyHQ SAML Jackson (enterprise SSO) | Modern auth library + SSO abstraction layer |
| **PDF Export** | pdf-lib (vector) + canvas-to-PNG fallback | Lightweight programmatic PDF creation |
| **Testing** | Vitest + React Testing Library + Playwright | Unit + integration + E2E |

---

## Directory Structure

```
mavisdraw/
├── package.json                          # Root workspace config
├── pnpm-workspace.yaml
├── turbo.json
├── PLAN.md
├── README.md
├── .gitignore
├── .prettierrc
├── eslint.config.mjs
├── tsconfig.base.json
├── docker-compose.yml                    # PostgreSQL + Redis (dev)
│
├── apps/
│   ├── web/                              # Frontend (Vite + React)
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── tsconfig.json
│   │   ├── index.html
│   │   ├── public/
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx
│   │       ├── routes/                   # Page components
│   │       │   ├── index.tsx             # Dashboard
│   │       │   ├── editor.tsx            # Diagram editor
│   │       │   ├── login.tsx
│   │       │   └── signup.tsx
│   │       ├── components/
│   │       │   ├── canvas/
│   │       │   │   ├── Canvas.tsx        # Main canvas React wrapper
│   │       │   │   ├── CanvasRenderer.ts # Dual-canvas render engine
│   │       │   │   ├── InteractionManager.ts  # Mouse/touch state machine
│   │       │   │   ├── HitTesting.ts
│   │       │   │   ├── SelectionManager.ts
│   │       │   │   ├── GridRenderer.ts
│   │       │   │   └── ViewportManager.ts
│   │       │   ├── elements/
│   │       │   │   ├── RectangleRenderer.ts
│   │       │   │   ├── EllipseRenderer.ts
│   │       │   │   ├── DiamondRenderer.ts
│   │       │   │   ├── LineRenderer.ts
│   │       │   │   ├── ArrowRenderer.ts
│   │       │   │   ├── TextRenderer.ts
│   │       │   │   ├── FreedrawRenderer.ts
│   │       │   │   ├── PortalRenderer.ts      # Nested diagram portal
│   │       │   │   └── ElementFactory.ts
│   │       │   ├── toolbar/
│   │       │   │   ├── Toolbar.tsx
│   │       │   │   ├── ToolButton.tsx
│   │       │   │   ├── StylePanel.tsx
│   │       │   │   └── LayerPanel.tsx
│   │       │   ├── navigation/
│   │       │   │   ├── Breadcrumb.tsx
│   │       │   │   ├── ZoomControls.tsx
│   │       │   │   └── Minimap.tsx
│   │       │   ├── collaboration/
│   │       │   │   ├── CursorOverlay.tsx
│   │       │   │   ├── PresenceAvatars.tsx
│   │       │   │   └── ShareDialog.tsx
│   │       │   ├── history/
│   │       │   │   └── VersionHistory.tsx
│   │       │   └── auth/
│   │       │       ├── LoginForm.tsx
│   │       │       └── SignupForm.tsx
│   │       ├── stores/
│   │       │   ├── elementsStore.ts      # Element CRUD + undo/redo
│   │       │   ├── diagramStore.ts       # Diagram tree navigation
│   │       │   ├── toolStore.ts          # Active tool
│   │       │   ├── selectionStore.ts     # Selection state
│   │       │   ├── uiStore.ts            # Panels, modals, theme
│   │       │   ├── collaborationStore.ts # Y.js integration
│   │       │   └── authStore.ts
│   │       ├── hooks/
│   │       │   ├── useCanvas.ts
│   │       │   ├── useKeyboard.ts
│   │       │   ├── useAutoSave.ts
│   │       │   └── useCollaboration.ts
│   │       └── styles/
│   │           └── globals.css
│   │
│   └── server/                           # Backend (Fastify)
│       ├── package.json
│       ├── tsconfig.json
│       ├── Dockerfile
│       └── src/
│           ├── index.ts
│           ├── app.ts
│           ├── routes/
│           │   ├── auth.ts
│           │   ├── projects.ts
│           │   ├── diagrams.ts
│           │   ├── versions.ts
│           │   ├── sharing.ts
│           │   └── export.ts
│           ├── ws/
│           │   └── hocuspocus.ts         # Y.js WebSocket server
│           ├── db/
│           │   ├── schema.ts             # Drizzle schema
│           │   ├── client.ts
│           │   ├── migrations/
│           │   └── seed.ts
│           ├── services/
│           │   ├── authService.ts
│           │   ├── diagramService.ts
│           │   ├── versionService.ts
│           │   ├── sharingService.ts
│           │   └── ssoService.ts
│           └── middleware/
│               ├── auth.ts
│               └── rateLimit.ts
│
├── packages/
│   ├── types/                            # Shared TypeScript types
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── elements.ts
│   │       ├── diagram.ts
│   │       └── user.ts
│   ├── math/                             # Geometry utilities
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── point.ts
│   │       ├── vector.ts
│   │       ├── bounds.ts
│   │       ├── intersection.ts
│   │       ├── bezier.ts
│   │       └── transform.ts
│   ├── renderer/                         # Shared rendering logic
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── roughHelpers.ts           # Rough.js sketchy mode
│   │       ├── smoothHelpers.ts          # Clean/polished mode
│   │       └── textMeasure.ts
│   └── export/                           # Export pipeline
│       ├── package.json
│       └── src/
│           ├── index.ts
│           ├── png.ts
│           ├── svg.ts
│           ├── pdf.ts
│           └── json.ts
│
└── e2e/                                  # Playwright E2E tests
    ├── playwright.config.ts
    └── tests/
```

---

## Core Data Model

### Elements

```typescript
// packages/types/src/elements.ts

type ElementType =
  | 'rectangle' | 'ellipse' | 'diamond' | 'triangle'
  | 'line' | 'arrow' | 'freedraw'
  | 'text' | 'image'
  | 'portal';  // nested diagram portal — the key differentiator

interface BaseElement {
  id: string;
  type: ElementType;
  diagramId: string;           // which diagram this element belongs to
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;               // rotation in radians
  opacity: number;             // 0-100

  // Styling
  strokeColor: string;
  backgroundColor: string;
  fillStyle: 'solid' | 'hachure' | 'cross-hatch' | 'none';
  strokeWidth: number;
  strokeStyle: 'solid' | 'dashed' | 'dotted';
  roughness: number;           // 0 = clean/polished, 1+ = sketchy
  renderMode: 'sketchy' | 'clean';

  // Organization
  layerId: string;
  groupIds: string[];          // ordered group memberships (supports nested groups)
  isLocked: boolean;
  isDeleted: boolean;          // soft delete

  // Binding
  boundElements: { id: string; type: string }[];

  // Versioning metadata
  version: number;
  updatedBy: string;
  updatedAt: number;
}

// Arrow/Line element
interface LinearElement extends BaseElement {
  type: 'line' | 'arrow' | 'freedraw';
  points: [number, number][];
  startBinding?: { elementId: string; gap: number };
  endBinding?: { elementId: string; gap: number };
  routingMode: 'straight' | 'curved' | 'elbow'; // right-angle routing
  startArrowhead: 'none' | 'arrow' | 'dot' | 'bar' | 'triangle';
  endArrowhead: 'none' | 'arrow' | 'dot' | 'bar' | 'triangle';
}

// Text element
interface TextElement extends BaseElement {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: 'hand-drawn' | 'sans-serif' | 'monospace';
  textAlign: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';
  containerId: string | null;   // if text is bound inside a shape
}

// Portal element — THE NESTED DIAGRAM KEY
interface PortalElement extends BaseElement {
  type: 'portal';
  targetDiagramId: string;      // the child diagram
  label: string;
  thumbnailDataUrl: string | null;  // cached preview
  portalStyle: 'card' | 'badge' | 'expanded';
}
```

### Diagram & Nesting

```typescript
// packages/types/src/diagram.ts

interface Diagram {
  id: string;
  projectId: string;
  parentDiagramId: string | null;  // null = root diagram
  parentPortalId: string | null;   // which portal in parent links here
  title: string;
  viewBackgroundColor: string;
  gridEnabled: boolean;
  gridSize: number;
  renderMode: 'sketchy' | 'clean';  // default for new elements
  layers: Layer[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

interface Layer {
  id: string;
  name: string;
  isVisible: boolean;
  isLocked: boolean;
  opacity: number;
  order: number;
}

interface Project {
  id: string;
  name: string;
  ownerId: string;
  rootDiagramId: string;
  isPublic: boolean;
  createdAt: number;
  updatedAt: number;
}
```

### Versioning

```typescript
// Periodic full snapshots for version history
interface DiagramSnapshot {
  id: string;
  diagramId: string;
  version: number;
  elements: BaseElement[];     // JSONB — full element array
  appState: object;            // JSONB — viewport, grid, layers
  createdBy: string;
  createdAt: number;
  trigger: 'auto' | 'manual';
  label: string | null;        // user-assigned version name
}
```

**Strategy**: Auto-snapshot hourly (if changes exist) + manual "save version". Restore creates a new snapshot (never overwrites). 90-day retention.

### Database Relations (Drizzle)

```
User → owns many → Project
Project → has one → root Diagram
Diagram → has many → Element (stored as JSONB column)
Diagram → has many → DiagramSnapshot
Diagram → parent/child → Diagram (self-referential via parentDiagramId)
Project → has many → ProjectPermission (sharing)
User → belongs to → Organization (optional, for SSO)
```

### Collaboration (Y.js Shared Types)

```
Y.Doc (one per diagram room)
  ├── Y.Map("elements")         // elementId → Y.Map(element props)
  ├── Y.Map("appState")         // viewport, grid, etc.
  ├── Y.Array("layerOrder")     // ordered layer IDs
  └── Awareness
      ├── cursor: { x, y }
      ├── selectedElementIds: string[]
      └── user: { id, name, color }
```

---

## Implementation Stages

### Stage 1: Foundation — Project Setup + Core Canvas + Basic Shapes
**Complexity: L | No dependencies**

**What gets built:**
- Monorepo scaffolding: `pnpm-workspace.yaml`, `turbo.json`, root configs
- `packages/types/` — core element and diagram type definitions
- `packages/math/` — point, vector, bounds, intersection utilities
- `apps/web/` — Vite + React 19 + TypeScript + Tailwind CSS 4
- HTML5 Canvas with dual-canvas architecture (static + interactive layers)
- `ViewportManager.ts` — pan (space+drag, middle-click), zoom (ctrl+scroll, pinch)
- `GridRenderer.ts` — dot grid background
- Dual rendering: Rough.js (sketchy) + native Canvas Path2D (clean), toggle per diagram
- Basic shapes: rectangle, ellipse, diamond, line, text
- `InteractionManager.ts` — state machine: idle → creating → dragging → resizing → selecting
- `HitTesting.ts` — point-in-shape, shape-overlap-rectangle
- `SelectionManager.ts` — single click, rubber-band multi-select, resize/rotate handles
- `elementsStore.ts` — Zustand with flat `Map<string, Element>`, CRUD actions
- `toolStore.ts` — active tool state
- `historyStore` — undo/redo via Zustand temporal middleware
- `Toolbar.tsx` — left-side vertical toolbar (Miro-style layout)
- Keyboard shortcuts: Delete, Ctrl+Z/Ctrl+Shift+Z, Ctrl+A, Escape, V/R/E/D/P tool keys

**Key files:** `apps/web/src/components/canvas/CanvasRenderer.ts`, `apps/web/src/stores/elementsStore.ts`, `packages/types/src/elements.ts`, `packages/math/src/`

---

### Stage 2: Advanced Drawing + Styling
**Complexity: L | Depends on: Stage 1**

**What gets built:**
- `ArrowRenderer.ts` — with arrowhead types (arrow, bar, dot, triangle)
- Three routing modes: straight, curved (bezier), elbow (right-angle with L/Z routing)
- Arrow binding: snap endpoints to shape edges, maintain binding on move
- `packages/math/src/bezier.ts` — bezier evaluation, splitting, projection
- `TextRenderer.ts` — multi-line text with wrapping, inline editing via contentEditable overlay
- Text-in-shape: text bound to container shapes, auto-wraps
- Font selection: hand-drawn (Virgil), sans-serif, monospace
- `FreedrawRenderer.ts` — freehand with point simplification
- Image support: drag-and-drop, paste from clipboard
- `StylePanel.tsx` — stroke/fill color pickers, stroke width, stroke style, fill style, opacity, roughness, font controls
- Grouping/ungrouping (Ctrl+G / Ctrl+Shift+G), nested groups
- `LayerPanel.tsx` — visibility toggle, lock toggle, opacity, drag-to-reorder
- Copy/paste/duplicate (Ctrl+C/V/D), cross-tab via system clipboard
- Smart guides: snap to edges/centers when dragging
- Alignment tools: left/center/right/top/middle/bottom, distribute evenly

**Key files:** `apps/web/src/components/elements/ArrowRenderer.ts`, `apps/web/src/components/toolbar/StylePanel.tsx`, `apps/web/src/components/toolbar/LayerPanel.tsx`

---

### Stage 3: Nested Diagrams — The Key Differentiator
**Complexity: XL | Depends on: Stage 1 (can overlap with Stage 2)**

**What gets built:**
- `PortalRenderer.ts` — renders as rounded rectangle with drill-down icon + label + cached thumbnail. Three styles: card (default), badge (compact), expanded (large preview)
- `diagramStore.ts` — `diagrams: Map<string, Diagram>`, `activeDiagramId`, `diagramPath: string[]` (breadcrumb trail), navigation actions
- **Drill-down interaction**: double-click portal → animated zoom into portal bounds → crossfade to child diagram. Reverse animation on "back"
- `Breadcrumb.tsx` — `Project > Root > Subsystem A > Component X`, each segment clickable
- Viewport state preserved per diagram level (zoom back out to exactly where you were)
- Thumbnail generation: render low-res preview to offscreen canvas when leaving a diagram
- `PortalProperties.tsx` — configure label, style, "create new child" vs "link existing", detach option
- Diagram tree sidebar: full hierarchy view, right-click context menu
- Lazy loading: child diagram elements load only when navigated to
- `elementsStore` scoped by `diagramId` — operations always scoped

**Key files:** `apps/web/src/components/elements/PortalRenderer.ts`, `apps/web/src/stores/diagramStore.ts`, `apps/web/src/components/navigation/Breadcrumb.tsx`

---

### Stage 4: Persistence + User Authentication
**Complexity: L | Depends on: Stage 1; can run in parallel with Stages 2-3**

**What gets built:**
- `apps/server/` — Fastify app with plugin architecture
- `db/schema.ts` — Drizzle ORM schema: users, sessions, projects, diagrams (JSONB elements), diagram_snapshots, project_permissions
- `drizzle-kit` migrations
- `docker-compose.yml` — PostgreSQL 16 + Redis
- Auth: email/password registration (bcrypt), JWT access+refresh tokens, httpOnly cookies, OAuth (Google, GitHub) via Better Auth
- REST API:
  - `POST/GET /api/projects` — create/list projects
  - `GET/PUT/DELETE /api/projects/:id`
  - `GET/PUT/POST/DELETE /api/diagrams/:id` — diagram CRUD with JSONB elements
  - `POST /api/diagrams/:id/save` — explicit save (creates snapshot)
- `useAutoSave.ts` — debounced save (2s after last change), dirty tracking, "Saving..."/"Saved" indicator
- Frontend auth: `authStore.ts`, login/signup pages, protected routes, token refresh on 401
- Dashboard page: project grid with thumbnails, create/delete/search

**Key files:** `apps/server/src/db/schema.ts`, `apps/server/src/routes/auth.ts`, `apps/server/src/routes/diagrams.ts`, `apps/web/src/hooks/useAutoSave.ts`

---

### Stage 5: Collaboration + Sharing
**Complexity: XL | Depends on: Stage 4 + Stage 3**

**What gets built:**
- Hocuspocus WebSocket server integrated with Fastify — auth hook (validate JWT), persistence hook (save Y.Doc to PostgreSQL), room per diagram
- `collaborationStore.ts` — Y.Doc per diagram, two-way binding: Zustand ↔ Y.js shared types
- `CursorOverlay.tsx` — remote cursors as colored arrows with name labels, position interpolation for smooth motion
- `PresenceAvatars.tsx` — avatar row, click to "follow" a user's viewport
- Colored border on elements being edited by others (soft lock)
- `ShareDialog.tsx` — generate shareable link with permissions (viewer/editor)
- Share API: create link, list permissions, update/revoke access, resolve share token
- Per-diagram rooms: drilling into a child joins a new collaboration room. Parent portals show "N users editing" badge.
- Basic offline support: Y.js queues operations locally, auto-syncs on reconnect

**Key files:** `apps/server/src/ws/hocuspocus.ts`, `apps/web/src/stores/collaborationStore.ts`, `apps/web/src/components/collaboration/`

---

### Stage 6: Versioning + Export
**Complexity: M | Depends on: Stage 4 + Stage 2**

**What gets built:**
- Version backend: hourly auto-snapshots for active diagrams, manual "save version" with label
- `GET /api/diagrams/:id/snapshots` — paginated version list
- `POST /api/diagrams/:id/snapshots/:snapshotId/restore` — restore creates new snapshot
- `VersionHistory.tsx` — slide-out timeline panel, click to preview (read-only overlay), restore button
- `packages/export/`:
  - `json.ts` — `.mavisdraw` format with full scene data
  - `png.ts` — offscreen canvas → PNG blob, embed scene JSON in PNG tEXt chunk for re-import
  - `svg.ts` — elements → SVG DOM (Rough.js has native SVG output)
  - `pdf.ts` — pdf-lib vector rendering. Multi-page option: each nested diagram = a page
- Export dialog: format selection, background on/off, scale, "include nested diagrams" toggle
- Import: `.mavisdraw` JSON, `.excalidraw` compatibility layer
- Snapshot retention: prune >90 days, compress JSONB via PostgreSQL TOAST

**Key files:** `packages/export/src/`, `apps/web/src/components/history/VersionHistory.tsx`, `apps/server/src/routes/versions.ts`

---

### Stage 7: Enterprise SSO + Polish
**Complexity: L | Depends on: Stage 4**

**What gets built:**
- BoxyHQ SAML Jackson integration for SAML 2.0 SSO
- SP-initiated SSO flow, JIT user provisioning on first login
- Support for: Azure AD, Okta, Google Workspace, OneLogin
- Organization model: members, roles (owner/admin/member/viewer), SSO config per org
- Admin UI for SSO configuration
- Performance: spatial indexing (R-tree) for viewport culling, element caching on offscreen canvas, code splitting
- Accessibility: keyboard navigation, ARIA labels, high contrast mode
- Dark mode / theme support
- Template library: flowchart, org chart, architecture diagram starters
- Right-click context menu, onboarding tooltips
- Mobile/tablet: touch gesture support (pinch zoom, two-finger pan)

**Key files:** `apps/server/src/services/ssoService.ts`, `apps/web/src/components/canvas/CanvasRenderer.ts` (perf refactor)

---

## Parallelization Map

```
Timeline:    ───────────────────────────────────────────────────────►

Agent A:     [Stage 1: Foundation]────►[Stage 2: Advanced Drawing]──►[Polish]
             canvas, shapes, tools      arrows, text, styling, layers

Agent B:     ................[Stage 3: Nested Diagrams]─────────────►[Polish]
                              starts once Stage 1 basics exist

Agent C:     ................[Stage 4: Backend + Auth]──►[Stage 5: Collaboration]
                              fully independent of drawing engine

Agent D:     ........................................[Stage 6: Export + Versioning]
                                                     after Stage 4 backend exists

Agent E:     ................................................[Stage 7: SSO + Enterprise]
                                                              after Stage 4 auth exists
```

### Parallel streams:
1. **A + C**: Frontend drawing engine and Backend/Auth are fully independent
2. **B**: Nested diagrams starts once Stage 1 canvas primitives work — touches different files than Stage 2
3. **D + E**: Versioning and SSO can run in parallel once Stage 4 backend is done
4. **packages/math + packages/export**: Pure-function libraries, can be developed/tested independently at any time

### Must be sequential:
- Stage 1 → Stage 2 and Stage 3
- Stage 4 → Stages 5, 6, 7
- Stage 5 depends on both Stage 3 (nested diagrams in collab) and Stage 4 (auth/persistence)

---

## Verification Plan

| Stage | How to verify |
|-------|---------------|
| **1** | Open app → draw rectangles, ellipses, diamonds, lines → select, move, resize, rotate, delete → undo/redo → pan/zoom → toggle sketchy/clean mode |
| **2** | Draw arrows between shapes (bind to edges) → switch straight/curved/elbow → edit text inline → style panel changes colors/fonts → group/ungroup → reorder layers |
| **3** | Double-click shape → enters child diagram → breadcrumb shows path → navigate back → portal badge visible → diagram tree sidebar works → thumbnail preview on hover |
| **4** | Register → login → create diagram → auto-saves → reload → diagram persists → dashboard lists diagrams → logout/login |
| **5** | Open diagram in 2 browsers → cursors visible → simultaneous edits sync → share link works with permissions → drill into nested diagram in collab |
| **6** | Make changes → version history shows entries → restore old version → export PNG/SVG/PDF/JSON → multi-page nested PDF → re-import JSON |
| **7** | Configure SSO → login via Okta/Azure AD → org management → role-based access → templates available |

**Test commands:**
```bash
pnpm turbo run test          # All unit/integration tests
pnpm turbo run typecheck     # TypeScript checking
pnpm turbo run lint          # ESLint
npx playwright test          # E2E tests
```

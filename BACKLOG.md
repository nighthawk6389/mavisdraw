# Backlog

## From the 2026-11 product audit (see `ROADMAP.md` §2–§4 for full context)

### Data integrity (P0)

- **Child diagrams are never persisted** — `apiCreateDiagram` (`apps/web/src/services/api.ts:224`) has no call sites; `diagramStore.createDiagram` only creates a client-side ID. Autosave of a child `PUT`s a non-existent diagram (404), Hocuspocus rejects the room (`apps/server/src/ws/hocuspocus.ts:19`), and child elements are never fetched (`apiGetDiagram` only for the root in `App.tsx:225`). Nested content is lost on reload.
- **REST autosave and Hocuspocus both write `diagrams.elements`** — last writer wins between collaborators (`useAutoSave.ts:52`, `hocuspocus.ts:88`). Snapshot restore (`routes/diagrams.ts:272`) never reaches the live Y.Doc.
- **Whole-element `Y.Map` replacement on every change** (`collaborationStore.ts:255-261`) — concurrent edits to different properties of one element don't merge; doc bloat. Remote deletes hard-delete while local deletes are soft (`collaborationStore.ts:224-229`).
- **Version history is IndexedDB-only** (`utils/versionDb.ts`) — not shared with collaborators or across devices.

### Security (P0)

- **GitHub client secret exfiltration / SSRF via client-supplied `enterpriseUrl`** (`routes/github.ts:57-67` → `githubService.ts:99-116`).
- **Viewers can write over WebSocket** — no `connection.readOnly` for viewers; access only checked at connect (`ws/hocuspocus.ts:9-35`).
- **Production seeds `demo@mavisdraw.dev` / `password123`** (`render.yaml:16`, `db/seed.ts`).
- **Share tokens returned to every collaborator** (`routes/sharing.ts:62-77`); links never expire.
- **AI agent:** client-supplied diagram markdown interpolated into the system prompt and client system messages accepted (`agentService.ts:15-20`, `routes/agent.ts:8-9`); no quotas/limits on `/api/agent/chat`.
- OAuth `state` never verified (`githubService.ts:94`); no env validation and a hard-coded JWT fallback secret (`authService.ts:8`); `trustProxy` unset so IP rate limiting is shared by all users behind the proxy (`app.ts:14`).

### Broken features

- **Share links lead nowhere** — `ShareDialog` builds `/share/:token` but there is no router and `apiJoinViaShareLink` (`api.ts:275`) is never called.
- **AI chat likely fails at runtime** — UI messages aren't passed through `convertToModelMessages`, and `reply.raw.writeHead` bypasses CORS headers (`routes/agent.ts:22,33`).
- **Ctrl/⌘+wheel zoom** — `preventDefault()` inside React's passive `onWheel` (`Canvas.tsx:657`) is ignored; use a native listener with `{ passive: false }`. Causes 3 e2e failures.
- **AI proposals overlap existing content** — fixed grid placement at (100,100) (`ProposalCard.tsx:74-81`); needs auto-layout.
- **No graceful shutdown** — Hocuspocus debounced writes are lost on deploy (`apps/server/src/index.ts`).
- **Undo reverts collaborators' edits** — one global full-snapshot stack; remote changes aren't recorded, so undo restores a pre-remote snapshot and the Y.js bridge broadcasts it (`elementsStore.ts:443-508`, `collaborationStore.ts:231-264`). Also: a step on every mouse-down, one per slider tick (`StylePanel.tsx:225-243`).
- **Bindings detach** — deleting a shape leaves its label (`elementsStore.ts:388-409`); resize/align/distribute don't move bound arrows/labels (`InteractionManager.ts:1358-1418`, `elementsStore.ts:75-97`); paste's `boundElements` remap is a no-op so dragging a pasted shape moves the original's label (`elementsStore.ts:1049-1054,823-836`).
- **PNG/PDF export is an `alert()` placeholder** (`ExportDialog.tsx:141-145`) although `packages/export` implements both.
- **Layers are decorative** — every element uses `layerId: 'default'` (`elementsStore.ts:110`); visibility toggles don't redraw.
- **Trackpad two-finger scroll zooms 10%/event instead of panning** (`InteractionManager.ts:1043-1045`); no touch/pen/pinch (mouse events only).
- **Virgil font is referenced but never loaded** (`CanvasRenderer.ts:1010`); three disagreeing font maps (`CanvasRenderer.ts:1007`, `Canvas.tsx:218,895`).
- **Resize handles hit-tested where they aren't drawn** (`CanvasRenderer.ts:1309-1318` vs `HitTesting.ts:436-472`); box-select misses arrows drawn up/left (bounds computed 5 ways).
- **Copy/paste** — paste ignores the system clipboard (no cross-tab), pastes 10px from the original instead of at the cursor (`elementsStore.ts:996-1037`).

### Performance

- No viewport culling, spatial index, or Rough.js drawable cache; interactive canvas redraws every idle frame; each drag tick copies the whole elements Map per moved element and re-diffs all elements into Y.js (`CanvasRenderer.ts:143-160,229,1230`, `elementsStore.ts:253,744`, `collaborationStore.ts:242-250`).
- Single 1.14 MB JS chunk — no code splitting.

### Testing / CI

- e2e removed from CI (`6db0d02`) though README says it runs; 102/106 pass locally. The Docker integration suite isn't in CI. Nothing tests Hocuspocus hooks, WS permissions, the agent route, or a real-backend nested-diagram round trip.
- Project pins `@playwright/test` 1.56.1; in environments with a different pre-installed Chromium, pass `launchOptions.executablePath`.

---

Items noticed during PR #9 review (arrow improvements) that weren't fixed immediately.

## Observability

- **Keep server-side logging** — All try/catch blocks in `apps/server/src/` must log caught exceptions using `request.log` (in routes/middleware) or `console.error` (in services). Never swallow errors silently. This is critical for debugging production issues.

## Code Quality

- **Duplicate `AnchorPosition` type** — `AnchorPosition` is defined in both `packages/types/src/elements.ts` and `apps/web/src/components/canvas/HitTesting.ts`. Consolidate into `@mavisdraw/types` and import from there.

- **`hoveredAnchor` typed as `string | null`** — Should be `AnchorPosition | null` in `InteractionManager.ts` for type safety.

- **`new Set()` allocated on every call** in `startTextEditing` (Canvas.tsx:122) and `handleDoubleClick` (InteractionManager.ts:1007). Extract to module-level constants like `SHAPE_TOOLS`.

- **`'points' in el` runtime check** used in multiple places (CanvasRenderer.ts:1532, elementsStore.ts:45) instead of discriminated union narrowing (`el.type === 'line' || el.type === 'arrow' || el.type === 'freedraw'`). Fragile if other element types ever gain a `points` property.

- **`bound.type === 'line'` is dead code** in `moveElementWithBindings` (elementsStore.ts:760). `bindArrow` always sets type to `'arrow'` (line 662), so the `'line'` branch never runs. Either binding should set the actual element type, or the dead branch should be removed.

- **`DEFAULT_STYLE.seed` computed once at module load** (elementsStore.ts:106). `createElement` overrides it, but `createBoundText` spreads `DEFAULT_STYLE` directly — all bound text elements share the same Rough.js seed.

- **Unused `vp` variable** in paste handler (Canvas.tsx:760). Dead code.

- **`getContentBounds` duplicates existing logic** (Canvas.tsx:914-938). Should reuse `CanvasRenderer.getElementsBounds()` or consolidate into `@mavisdraw/math`.

## Performance

- **`handleKeyDown` callback recreated on every element change** — `selectedIds` is in the dependency array of `useKeyboard`'s `handleKeyDown`, causing the `keydown` listener to be rebound whenever selection changes. Could use a ref for `selectedIds` similar to the `elements` fix.

- **`moveElementWithBindings` doesn't call `pushHistory`** — This is intentional (caller manages history), but inconsistent with all other mutation methods. Document the contract or add an internal `_skipHistory` flag for clarity.

## Architecture

- **Implicit `as Partial<LinearElement>` casts** throughout when calling `updateElement` with linear-specific fields like `points` or `routingMode`. A type-safe approach would use typed overloads or a generic `updateElement<T extends MavisElement>`.

- **`createElement` name is misleading** — It only creates and returns an element object with defaults but does not add it to the store. Renaming to `buildElement` or `createElementTemplate` would clarify the contract.

- **`moveElementWithBindings` inconsistent history contract** — Unlike all other mutation methods which call `pushHistory()` internally, this one relies on the caller to have already pushed. Should be documented or unified.

## Testing

- **No e2e tests for multi-element resize** — The `performResize` multi-element branch was broken (used position as width). Add e2e coverage for resizing multiple selected elements.

- **No e2e tests for undo during drag** — History flooding was fixed, but there's no test verifying that a single undo reverses an entire drag operation.

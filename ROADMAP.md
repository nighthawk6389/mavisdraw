# MavisDraw — State of the Product & Roadmap to World-Class

_Research snapshot: 2026-11-26 · Based on a full read of the codebase at `edcb5e1`, a local run of every test suite, and two independent code audits (backend security, canvas engine)._

---

## Progress (updated as phases land)

| Phase                             | Status                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real-backend e2e lane + CI        | ✅ Done — `apps/web/e2e-real`, Postgres service job in CI                                                                                                                                                                                                                                                                                                                              |
| 1. Editing on par with Excalidraw | ✅ Core done (collaboration-safe undo, bindings, navigation, context menu, z-order/lock, PNG/PDF, perf, bundle). Remaining items in `BACKLOG.md`                                                                                                                                                                                                                                       |
| 2. Living architecture map        | ✅ Core done (nested diagrams persist + lazy-load, connector labels, Mermaid → nested map, auto-layout/Tidy up, ⌘K jump-to-anything, drill-out animation, AI agent fixed end-to-end). Remaining items in `BACKLOG.md`                                                                                                                                                                  |
| 3. Teams                          | ✅ Core done (Y.js owns live elements with per-property merge, URLs + share links + deep links, viewer role enforced end-to-end, shared server-side version history with live restore, REST reads see live state, graceful shutdown). Comments, visual diff, orgs, presentation mode remain — see `BACKLOG.md`                                                                         |
| Follow-ups (after Phase 3)        | ✅ Independent collaboration review fixed (sync integrity, security), undo-safe vs teammates, comments & @mentions, version compare, offline journal, presentation mode, workspaces/invites/folders, repo → map + drift. Remaining items in `BACKLOG.md`                                                                                                                               |
| Production hardening              | ✅ Security P0s (startup secret checks, signed OAuth state, GitHub host allowlist, explicit `TRUST_PROXY`, no prod seed), versioned migrations run pre-deploy, request ids + safe 5xx + `/api/ready` + optional Sentry, transactional email (Resend/Postmark). Deploy env vars in PR #20                                                                                               |
| Map ⇄ agents & distribution       | ✅ MCP server for coding agents (read the map, find the component that owns a file, propose updates reviewed in the editor — `docs/mcp.md`); embeds: an interactive iframe viewer and a live README SVG (`docs/embeds.md`); pull request checks via a GitHub App: one comment per PR with touched components and architecture changes, and a proposed map update (`docs/pr-checks.md`) |
| Adoption                          | 🚧 First run (welcome: map a repo / explore a sample / templates; empty-map bar) and a template gallery (C4, microservices, AWS, event-driven, data pipeline, SaaS) as nested maps. Self-hosted Docker release next                                                                                                                                                                    |

## 1. TL;DR

MavisDraw went from empty repo to a broad full-stack diagramming app in **~2 weeks (Feb 28 – Mar 12, 2026)**, built mostly by AI agents following `PLAN.md`. Stages 1–6 shipped, Stage 7 (SSO, performance, a11y, dark mode, templates, mobile) never started, and the repo has been idle since March.

**What's good:** a real canvas engine (Rough.js sketchy + clean modes, smart arrows with binding/elbow routing/waypoints), the nested "portal" drill-down concept, Y.js real-time collaboration, 8 import/export formats, a GitHub integration, an LLM-readable diagram format, and an AI chat agent. 661 unit tests pass, typecheck and build are clean.

**What's not:** the pieces were built in parallel and **the seams between them are broken**. The core differentiator — nested diagrams — **does not persist** to the server; share links lead nowhere; REST autosave and the collaboration server both write the same rows and clobber each other; undo in a shared diagram reverts teammates' work; the AI chat almost certainly fails at the HTTP layer; PNG export is a placeholder; viewers can edit over WebSocket; any logged-in user can exfiltrate the GitHub OAuth client secret; production is seeded with a public demo password. A user who tries the product end-to-end today would lose data.

**Recommendation:** don't try to out-Miro Miro. Spend ~3 weeks making the product trustworthy (Phase 0), ~6 weeks reaching Excalidraw-level editing feel (Phase 1), then go all-in on the wedge nobody else owns: **zoomable, code-linked architecture maps that AI keeps up to date** (Phase 2).

---

## 2. What exists today

### 2.1 Repository map

| Package           | Source lines | Test lines | Purpose                                                                | Tests                              |
| ----------------- | ------------ | ---------- | ---------------------------------------------------------------------- | ---------------------------------- |
| `apps/web`        | 14,457       | 6,672      | React 19 + Zustand + Canvas editor, dashboard, auth UI, panels         | 333 unit, 106 e2e                  |
| `apps/server`     | 2,740        | 942        | Fastify 5, Drizzle/Postgres, Hocuspocus (Y.js), GitHub OAuth, AI agent | 21 unit + Docker integration suite |
| `packages/math`   | 1,327        | 1,763      | Geometry, Bézier, elbow routing                                        | 227                                |
| `packages/export` | 1,085        | 307        | PNG (with embedded scene), SVG, PDF (raster), JSON                     | 20                                 |
| `packages/compat` | 1,676        | 914        | Excalidraw ⇄, draw.io ⇄, Miro →                                        | 49                                 |
| `packages/llm`    | 658          | 483        | Markdown topology serialize/deserialize                                | 11                                 |
| `packages/types`  | 331          | —          | Shared types                                                           | —                                  |

### 2.2 Feature inventory

Legend: ✅ works · ⚠️ works with significant caveats · ❌ broken · ⬜ missing

**Editing**

- ✅ Rectangle, ellipse, diamond, triangle, line, arrow, freedraw, text, image, portal
- ✅ Sketchy (Rough.js) and clean render modes, grid, pan/zoom (wheel, right-drag, space)
- ✅ Arrows: binding to shapes, straight/curved/elbow routing, arrowhead picker, anchor-initiated connections, endpoint rebinding, waypoints
- ✅ Bound text inside shapes with vertical alignment; style panel (stroke/fill/width/style/opacity/roughness/fonts); grouping with nested groups; align/distribute; smart guides while dragging
- ⚠️ Undo/redo works solo, but **in a shared diagram undo reverts collaborators' edits and deletes their new elements** (§4)
- ⚠️ Labels and bound arrows **detach during routine edits**: deleting a shape leaves its label floating; resize/align/distribute/paste leave bound arrows and labels behind (§4)
- ❌ Layers panel is decorative: every element is hard-coded to layer `'default'` (`elementsStore.ts:110`); visibility toggles don't redraw
- ❌ Trackpad/touch: plain two-finger scroll **zooms** (10% per event) instead of panning (`InteractionManager.ts:1043-1045`); `preventDefault()` in React's passive `onWheel` (`Canvas.tsx:657`) is ignored, so pinch can zoom the whole page (3 e2e tests fail on this); mouse events only — no touch, pen, or pinch
- ⬜ Rotation UI, z-order, context menu, per-element lock, eraser, zoom controls / fit, minimap, dark mode (0 `dark:` classes), accessibility (1 `aria-label` in the app), i18n, shape/icon libraries, templates, sticky notes, frames, comments, search
- ⚠️ The "hand-drawn" font names Virgil but never loads it (no `@font-face`), so text renders in a different font on every OS — and for every collaborator

**Nested diagrams (the differentiator)**

- ✅ Portal element, double-click drill-down, breadcrumb, diagram tree sidebar, per-level viewport cache, portal thumbnails
- ❌ **Child diagrams are never created on the server.** `apiCreateDiagram` (`apps/web/src/services/api.ts:224`) has zero call sites; `diagramStore.createDiagram` only adds a client-side nanoid. Consequences: autosave `PUT /api/diagrams/:childId` → 404 ("Save failed"); Hocuspocus `onAuthenticate` throws "Diagram not found" for the child room (`apps/server/src/ws/hocuspocus.ts:19`); on reload the portal points at a diagram that doesn't exist. Child elements are also never fetched — `apiGetDiagram` is only called for the root (`App.tsx:225`).

**Persistence & collaboration**

- ✅ Email/password auth with JWT access + refresh, project CRUD, dashboard with search
- ✅ Hocuspocus server, remote cursors, presence avatars, follow-user viewport
- ❌ **Dual write / last-writer-wins.** Every client runs `useAutoSave` (full element array `PUT` every 2 s of changes) _and_ Hocuspocus `onStoreDocument` writes the same `elements` column. With two editors the slower writer silently overwrites the other's work.
- ⚠️ Each element change replaces the whole `Y.Map` for that element (`collaborationStore.ts:255-261`), so concurrent edits to different properties of one element don't merge, and the Y.Doc grows with tombstones. Y.Doc binary state is never persisted — the doc is re-seeded from JSON on every load (`hocuspocus.ts:38-66`), discarding CRDT history.
- ⚠️ Remote deletes hard-delete from the store while local deletes are soft (`collaborationStore.ts:224-229`).
- ❌ **Share links are dead.** `ShareDialog` builds `${origin}/share/${token}` but there is no router and nothing calls `apiJoinViaShareLink` (`api.ts:275`). Recipients land on the dashboard/login with no access.
- ⬜ URL routing / deep links to a project or diagram (app state is a `useState<'dashboard'|'editor'>`)

**Versioning, export, interop**

- ⚠️ Version history is **IndexedDB only** (`utils/versionDb.ts`) — per browser, not shared with collaborators, lost on another device. The server has `apiSaveDiagram` snapshots but the UI doesn't use them.
- ✅ Export from the dialog: `.mavisdraw`, SVG, Excalidraw, draw.io, Miro, LLM markdown
- ❌ **PNG and PDF export show an `alert()` placeholder** (`ExportDialog.tsx:141-145`). `packages/export` has PNG (with scene embedded for re-import) and PDF (raster-in-PDF) implementations, but they aren't wired to the UI. PNG is the most-used export in every comparable tool.
- ✅ Import: `.mavisdraw`, PNG-with-scene, Excalidraw, draw.io
- ⚠️ Copy writes to the system clipboard but paste reads only the in-app clipboard (no cross-tab paste); pasted items land 10 px from the original, not at the cursor; images are stored as full-resolution inline base64 (synced, saved and snapshotted on every change)

**GitHub + AI**

- ✅ GitHub OAuth (incl. Enterprise), encrypted token storage, repo/branch/tree browser, link a portal to `owner/repo@path`
- ❌ AI chat panel (Vercel AI SDK, streaming) with tools `browse_diagram`, `browse_code`, `read_file`, `propose_changes`; proposals render as reviewable cards. **Very likely fails end-to-end today:** the server never converts the UI's message format and its raw stream bypasses CORS headers (§3.1). Unit tests only cover the prompt/tool functions.
- ❌ GitHub connect fails on a fresh Render deploy: `GITHUB_*` and the token encryption key aren't in `render.yaml`
- ⚠️ Model is pinned to `claude-sonnet-4-20250514` (`agentService.ts:11`) — two generations old
- ⚠️ Applied proposals are dropped into a fixed 4-column grid at (100,100) (`ProposalCard.tsx:74-81`) — they overlap existing content; no auto-layout; can't target nested diagrams
- ⚠️ The diagram markdown is interpolated into the system prompt, so every edit invalidates the prompt cache and user-authored labels sit in the highest-trust position

**Dashboard / growth surface**

- ⚠️ Project cards show a placeholder icon (no thumbnails); no templates, no onboarding, no landing page, login wall before any value (no guest mode)

### 2.3 Health check (run locally on this snapshot)

| Check                        | Result                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `pnpm run test`              | ✅ 661 / 661 pass (math 227, web 333, compat 49, server 21, export 20, llm 11)                               |
| `pnpm run typecheck`         | ✅ clean                                                                                                     |
| `pnpm run lint`              | ✅ 0 errors, 38 warnings (unused vars, `any` in tests, hook deps)                                            |
| `pnpm run build`             | ✅ — but a **single 1.14 MB JS chunk** (384 KB gzip); no code splitting                                      |
| e2e (Playwright, mocked API) | ⚠️ 102 / 106 pass. 3 fail on the passive-wheel console error, 1 (dev auto-login) times out                   |
| CI                           | ⚠️ e2e was **removed from CI** (`6db0d02`) although the README says it runs; no job exercises a real backend |
| Observability                | ⬜ no Sentry/OTel/analytics anywhere                                                                         |

---

## 3. Backend & security audit

The REST authorization model is mostly sound: every diagram route checks project access and blocks viewers from writes, and no IDOR was found. The problems are at the edges: WebSocket, GitHub OAuth, the AI endpoint, and deployment config.

### 3.1 Ranked issues

| Sev         | Issue                                                                                                                                                                                                                                                                                                                         | Evidence                                                                            | Fix                                                                                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔴 Critical | **GitHub client-secret exfiltration / SSRF.** `enterpriseUrl` comes from the request body and becomes the host the server POSTs `client_id` + `client_secret` to. Any logged-in user can point it at their own server.                                                                                                        | `routes/github.ts:57-67`, `services/githubService.ts:99-116`                        | Allow-list enterprise hosts via env; never accept the host from the client.                                                                                   |
| 🔴 Critical | **Viewers can edit over WebSocket.** `onAuthenticate` accepts any role and never sets `connection.readOnly`; `onStoreDocument` persists their edits. Access is only checked at connect, so revoked users keep editing.                                                                                                        | `ws/hocuspocus.ts:9-35`                                                             | `connection.readOnly = role === 'viewer'`; re-check access periodically / on revoke.                                                                          |
| 🟠 High     | **Public demo credentials in production.** `render.yaml` runs `db:seed` in the prod build, creating `demo@mavisdraw.dev` / `password123`.                                                                                                                                                                                     | `render.yaml:16`, `db/seed.ts:20-24`                                                | Remove from prod build; seed refuses when `NODE_ENV=production`.                                                                                              |
| 🟠 High     | **Share tokens leak to every collaborator.** `GET /projects/:id/permissions` is open to any role and returns all `shareToken`s — a viewer can grab an editor link; links never expire, so revoked users can rejoin.                                                                                                           | `routes/sharing.ts:62-77`, `services/sharingService.ts:90`                          | Owner/admin only; add expiry + single-use or domain-restricted links.                                                                                         |
| 🟠 High     | **AI chat is very likely non-functional.** The UI (`useChat`) sends UIMessages; the server casts them to `ModelMessage[]` without `convertToModelMessages`. The stream is written via `reply.raw.writeHead`, bypassing `@fastify/cors` headers, so the cross-origin browser fetch fails (dev and prod are both cross-origin). | `routes/agent.ts:8,22,33`, `components/agent/AgentPanel.tsx:42-52`                  | `convertToModelMessages`; `reply.hijack()` + set CORS headers; add a real-backend e2e for the agent.                                                          |
| 🟠 High     | **Prompt injection with the user's GitHub token.** Client-supplied `diagramMarkdown` (any length, not tied to an authorized diagram) is interpolated into the system prompt; client `role:'system'` messages pass through; `browse_code`/`read_file` then run with the user's token against any repo the model chooses.       | `services/agentService.ts:15-20,124,158`, `routes/agent.ts:8-9`                     | Load the diagram server-side by authorized ID; put it in a delimited user turn; reject client system messages; restrict tools to repos linked in the diagram. |
| 🟠 High     | **No AI cost controls.** No rate limit, payload limit, output-token cap or abort-on-disconnect on `/api/agent/chat`. Combined with the public demo account, anyone can burn the API budget.                                                                                                                                   | `routes/agent.ts:13`, `agentService.ts:210-216`                                     | Per-user/org quotas, `maxOutputTokens`, body limits, propagate abort signal.                                                                                  |
| 🟠 High     | **Last-writer-wins data loss** between REST autosave, snapshot restore and Hocuspocus (see §2.2). Restore writes to the DB but never reaches the live Y.Doc, so it's overwritten if anyone is connected.                                                                                                                      | `ws/hocuspocus.ts:88`, `services/diagramService.ts:69-80`, `routes/diagrams.ts:272` | Y.js binary state as the single write path (Phase 0.2).                                                                                                       |
| 🟡 Medium   | **Rate limiting is ineffective in prod.** Hand-rolled in-memory map keyed by IP, only on login/register; no `trustProxy`, so behind Render's proxy all users share one bucket.                                                                                                                                                | `middleware/rateLimit.ts:8,15`, `app.ts:14`                                         | `trustProxy` + `@fastify/rate-limit` with Redis.                                                                                                              |
| 🟡 Medium   | **No env validation; hard-coded JWT fallback secret**; `COOKIE_SECRET` is set but unused (cookie isn't signed); `ANTHROPIC_API_KEY`, `GITHUB_*` and the encryption key are missing from `render.yaml`, so those features 500 on a fresh deploy.                                                                               | `authService.ts:8`, `app.ts:27`, `render.yaml`                                      | Zod-validated env at boot; fail fast in prod.                                                                                                                 |

### 3.2 Other findings

- **Auth:** refresh tokens stored plaintext and unindexed (`schema.ts:44,48`), no reuse detection, no "log out everywhere", **no password reset or change**, account enumeration via register 409 and login timing. Cross-site refresh cookie (`SameSite=Lax`) may not be sent if the web and API live on different registrable domains — likely the case on `*.onrender.com`; verify on the live deploy.
- **GitHub:** OAuth `state` generated but never verified (`githubService.ts:94`); `repo` scope grants write but the app only reads; disconnect doesn't revoke the token on GitHub; no key rotation for the AES-GCM token key.
- **Validation:** `elements`/`layers` are `z.array(z.any())` with no count/shape limits (`routes/diagrams.ts:28,33`); `viewBackgroundColor` unbounded vs `varchar(20)` → 500; unchecked `limit`/`offset`; GitHub path segments not URL-encoded; WebSocket messages up to `ws`'s 100 MiB default and stored unvalidated.
- **Data model:** editors can delete the root diagram and orphan children (no FK on `parentDiagramId`, `schema.ts:95`); `isPublic` is ignored by `checkProjectAccess`; snapshot version numbers race to a unique-index 500 (`diagramService.ts:96-120`); snapshots have no retention.
- **Ops:** 500s echo `error.message` (`app.ts:54-58`); health check doesn't touch the DB; **no graceful shutdown**, so Hocuspocus's debounced writes are lost on every deploy (`index.ts`); no helmet/CSP; single-instance only (no Hocuspocus Redis extension); server Docker image runs as root with dev deps; `drizzle-kit push` instead of migrations.
- **Tests:** the Docker integration suite (`__tests__/integration/full-workflow.spec.ts`) covers the main REST flows but isn't in CI. Nothing tests the Hocuspocus hooks, WS permissions, the agent route, GitHub routes or rate limiting.

---

## 4. Canvas engine audit

Paths relative to `apps/web/src`. Performance figures are estimates from reading the code, not measurements — add the benchmark in §7 before optimizing.

### 4.1 Rendering & performance — won't scale much past ~1k elements

- A continuous rAF loop redraws the **interactive canvas every frame even when idle** (`CanvasRenderer.ts:143-160`); idle frames also walk the whole elements Map across all diagrams (`Canvas.tsx:469-478`).
- The static canvas redraws on any `elements` change and on every pan/zoom/drag tick — **no cached bitmap, no viewport culling** (`CanvasRenderer.ts:229-243`), **no spatial index** (hit tests are linear and rebuild a Map per call, `HitTesting.ts:397-406`).
- **Rough.js drawables are regenerated on every redraw** (`CanvasRenderer.ts:1230-1240`) although seeds are stable; bound text is re-wrapped with one `measureText` per word per redraw.
- **Dragging is O(k·N) per mouse move:** each moved element copies the whole Map (`elementsStore.ts:253,744`); six components subscribe to the entire Map (editor root, Canvas, StylePanel, tree sidebar, autosave…); the Y.js bridge diffs all N elements and rewrites each moved element as a fresh `Y.Map` — including inline image data (`collaborationStore.ts:242-250`).
- Rough estimate: 1k elements fine in clean mode, stutters in sketchy; 5k drops below 60 fps; 10k sketchy is unusable.

### 4.2 Undo/redo — destroys collaborators' work

- Full-snapshot history: every `pushHistory` clones every element of every diagram, up to 100 snapshots (`elementsStore.ts:18,236-244,443-465`).
- Noisy steps: mouse-down on any element records a step even without movement; shape creation records 2; a bound arrow up to 4; StylePanel records one per selected element and **one per slider/color tick**, so a single slider drag can flush the whole history (`StylePanel.tsx:104-110,225-243`).
- **One global stack for all users**: remote edits aren't recorded, so undo restores a pre-remote snapshot, and the sync bridge then broadcasts it — reverting teammates' changes and deleting their new elements.

### 4.3 Correctness bugs

- Deleting a shape leaves its label floating (`elementsStore.ts:388-409` deletes only the selected IDs).
- Resize/align/distribute don't update bound arrows or labels (`InteractionManager.ts:1358-1418`, `elementsStore.ts:75-97`); resizing freedraw changes the box, not the stroke.
- Paste's `boundElements` remap is a no-op and `moveElementWithBindings` ignores `containerId` — dragging a pasted shape moves the _original's_ label (`elementsStore.ts:1049-1054,823-836`).
- Resize handles are hit-tested in a different place than they're drawn (padding/zoom mismatch, `CanvasRenderer.ts:1309-1318` vs `HitTesting.ts:436-472`).
- Bounds are computed five different ways; the x/width ones are wrong for arrows drawn up/left, so box-select misses them. Font mapping exists three times and disagrees, so text boxes are measured with a different font than they're drawn with.
- Portal thumbnails don't trigger a redraw when loaded, and their cache never evicts (`elements/PortalRenderer.ts:19-30`).
- Triangle has no toolbar tool and hit-tests as a diamond; `snapToGrid` is never read; `isLocked` is never read; Shift doesn't preserve aspect ratio; Shift-click can't deselect; freedraw preview shimmers in sketchy mode (new seed per move); Ctrl+V keydown `preventDefault` may suppress the native paste event for OS images (unconfirmed).

### 4.4 Code health

- God objects: `CanvasRenderer.ts` 1,734 lines, `InteractionManager.ts` 1,419 (an 11-mode switch), `elementsStore.ts` 1,304, `Canvas.tsx` 994.
- ~138 `as` casts in the audited folders (52 in `elementsStore.ts`), driven by the untyped `Partial<MavisElement>` update API; a `window as any` test hook ships to production (`Canvas.tsx:466`).
- History lives in the elements store, so every history push triggers the O(N) collaboration diff.
- No ARIA on the toolbar/canvas (`ToolButton.tsx` has no `aria-label`/`aria-pressed`; tooltips are hover-only); StylePanel labels aren't associated with controls.

---

## 5. Where to compete

The general-purpose whiteboard market is saturated and largely free (Excalidraw, tldraw, FigJam, Miro, draw.io). MavisDraw will not win there on features, and shouldn't try.

What MavisDraw has that those don't — **in combination** — is:

1. **Nested drill-down** (C4-style zoom levels as a first-class primitive),
2. **Diagram ↔ code links** (portals pointing at repo paths),
3. **An LLM-native diagram format** plus an agent that can read code and propose diagram edits.

That combination maps directly onto the most painful problem in architecture documentation: **diagrams rot the moment they're drawn.** The closest competitors attack pieces of it — IcePanel and Structurizr (C4 model + zoom levels, but formal/heavy), Ilograph (interactive multi-perspective, code-defined), Eraser and D2 (diagram-as-code + AI, but flat) — none pairs a delightful freeform canvas with drill-down _and_ keeps it in sync with the repo.

**Positioning:** _"A living map of your system. Zoom from the whole platform down to a single service, click through to the code, and let AI keep it current."_

**Primary user:** staff/senior engineers, platform & architecture teams, eng managers onboarding new hires. **Secondary:** anyone who uses Excalidraw today and wants depth.

---

## 6. Roadmap

### Phase 0 — Make it trustworthy (≈ 2–3 weeks) — _ship-blockers_

Nothing else matters until a user can draw, nest, reload, and share without losing work.

| #    | Item                                                                                                                                                                                                                                                                                       | Where                                                                                                              | Done when                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1  | **Persist nested diagrams.** Call the server when a portal creates a child (or make `PUT` upsert with project/parent checks); lazy-load child elements on navigation.                                                                                                                      | `diagramStore.createDiagram`, `Canvas.tsx:386`, `PortalProperties.tsx:66`, `App.tsx:198-238`, `routes/diagrams.ts` | Real-backend e2e: create portal → drill in → draw → reload → content present.                                                          |
| 0.2  | **One source of truth for element data.** While connected, Y.js owns elements; persist the Y.Doc binary (`Y.encodeStateAsUpdate`) in its own table and derive the JSON snapshot from it. REST keeps metadata + offline fallback only. Write only changed keys into each element's `Y.Map`. | `useAutoSave.ts`, `collaborationStore.ts`, `ws/hocuspocus.ts`, `db/schema.ts`                                      | Two-browser convergence test: concurrent edits to different props of one element both survive; no REST element writes while connected. |
| 0.3  | **Collaborative, per-gesture undo.** Replace full-snapshot history with `Y.UndoManager` tracking only the local origin; one step per gesture (no step on bare mouse-down, one per slider drag, one per bound-arrow creation).                                                              | `elementsStore.ts:18,236-244,443-508`, `InteractionManager.ts:471`, `StylePanel.tsx:104-110,225-243`               | 2-client test: A undoes, B's edits survive. One Ctrl+Z reverses one drag.                                                              |
| 0.3b | **Binding integrity.** Deleting a shape deletes its label; resize/align/distribute/paste update bound arrows and labels; paste remaps `boundElements`/`containerId`.                                                                                                                       | `elementsStore.ts:75-97,388-409,823-836,1049-1054`, `InteractionManager.ts:1358-1418`                              | Unit tests per operation.                                                                                                              |
| 0.4  | **Add a router** (`/`, `/p/:projectId/d/:diagramId`, `/share/:token`, `/login`) and wire `apiJoinViaShareLink`. Deep links restore the drill-down path.                                                                                                                                    | `App.tsx`, `ShareDialog.tsx`                                                                                       | e2e: open share link in a fresh context → lands in the editor with the right role.                                                     |
| 0.5  | **Security fixes** from §3 (top items: WS read-only for viewers, prod seed, etc.).                                                                                                                                                                                                         | see §3                                                                                                             | Each fix has a regression test.                                                                                                        |
| 0.6  | **Navigation that works on laptops:** native `wheel` listener with `{ passive: false }`; two-finger scroll pans, pinch / Ctrl+wheel zooms proportionally to delta; move to Pointer Events.                                                                                                 | `Canvas.tsx:656-662,946-951`, `InteractionManager.ts:1036-1048`                                                    | The 3 failing zoom e2e tests pass; trackpad pan e2e added.                                                                             |
| 0.6b | **Wire PNG/PDF export** to the existing `packages/export` implementations (currently an `alert()`); bundle the Virgil font so text renders the same for everyone.                                                                                                                          | `ExportDialog.tsx:141-145`, `CanvasRenderer.ts:1007`                                                               | e2e downloads a PNG that re-imports.                                                                                                   |
| 0.6c | **Layers: make them real or hide the panel** (elements all use `'default'`).                                                                                                                                                                                                               | `elementsStore.ts:110`, `LayerPanel.tsx`                                                                           | No UI that silently does nothing.                                                                                                      |
| 0.7  | **CI parity:** restore e2e in CI, add a job with a Postgres service that runs the integration suite and a real-backend e2e smoke test.                                                                                                                                                     | `.github/workflows/ci.yml`                                                                                         | CI red on any of the above regressions.                                                                                                |
| 0.8  | **Observability:** Sentry (web + server), structured request logs, uptime check, basic product analytics.                                                                                                                                                                                  | new                                                                                                                | Errors from prod visible within minutes.                                                                                               |
| 0.9  | **Migrations, not `db:push`, in prod**; remove `db:seed` from the production build.                                                                                                                                                                                                        | `render.yaml`, `drizzle.config.ts`                                                                                 | Deploy uses `drizzle-kit migrate`.                                                                                                     |

### Phase 1 — Editing feel on par with Excalidraw/tldraw (≈ 4–6 weeks)

Engineers will judge the product in the first 60 seconds of drawing. Detailed engine findings are in §4; the product-level list:

- **Performance (see §4.1):** cache Rough.js drawables keyed by `id+version`; viewport culling + an R-tree; stop the idle interactive redraw; cache the static layer as a bitmap during pan/zoom; one batched store update per gesture instead of a Map copy per element; narrow the six whole-Map subscriptions; write only changed fields to Y.js. Target: 60 fps pan/zoom at 2,000 elements, usable at 10,000.
- **Break up the god objects** before adding features on top: split `InteractionManager` into per-tool handlers, consolidate the five bounds functions and three font maps into `packages/math` / one text-measure module, and give `updateElement` a typed per-element API to retire the `as` casts.
- **Code-split** the 1.14 MB bundle: lazy-load export (`pdf-lib`), compat, AI panel, GitHub, version history. Target < 300 KB gzip initial.
- **Core interactions people expect on day one:** rotation handle, z-order (bring forward/back), right-click context menu (right-drag currently pans), per-element lock, eraser, Shift-to-keep-aspect, Shift-click deselect, Alt-drag duplicate, arrow-key nudge, **arrow labels** (double-click currently cycles routing), paste at cursor and from the system clipboard (images, Excalidraw JSON, cross-tab), zoom controls + zoom-to-fit/selection, minimap, Cmd+K command palette and find-element-across-all-levels.
- **Architecture shape libraries:** AWS / GCP / Azure / Kubernetes / generic infra icons, database/queue/service stencils. This is table stakes for the target user.
- **Text quality:** proper wrapping, auto-grow, rich-ish text (bold/code), font loading.
- **Images to object storage** (S3/R2) instead of inline data URLs in JSONB.
- **Dark mode, accessibility pass** (ARIA labels, focus order, keyboard-operable panels), touch/pen/pinch.
- **Dashboard:** real thumbnails, recents, folders, duplicate project, templates.
- **Guest mode:** draw without signing up (local-first via `y-indexeddb`), sign up to save/share. This is Excalidraw's growth engine.

### Phase 2 — Differentiate: the living architecture map (≈ 6–10 weeks)

This is where MavisDraw becomes the best at something.

1. **Model + views.** Introduce a lightweight model layer (components and relationships) beneath the visual elements, so "Auth Service" is _one_ thing that can appear at several zoom levels and in several views. Renaming it updates everywhere; the agent and exports reason over the model. This is the single most important architectural decision for the architecture-tool positioning — make it before the data grows.
2. **Drill-down that feels magical:** animated zoom into portals (planned in `PLAN.md` Stage 3), live mini-previews inside portals, "N people here" badges, portal styles that preview child topology, keyboard drill in/out.
3. **Repo → map in minutes.** The agent reads the GitHub tree plus manifests (`package.json`, `docker-compose`, Helm/K8s, Terraform, OpenAPI, proto) and proposes a multi-level map with a portal per service, already linked to code. Requires…
4. **Auto-layout** (ELK.js layered/orthogonal) shared by AI proposals, LLM-markdown import, and future diagram-as-code import. Replaces the fixed grid in `ProposalCard.tsx`.
5. **Drift detection.** A GitHub App + webhooks: on each PR, map changed paths to linked components and comment "this PR touches _Auth Service_ — here's a proposed diagram update", plus dead-link checks. This is the "keeps itself current" promise.
6. **Diagram-as-code interop:** import/export Mermaid, D2, PlantUML, Structurizr DSL; formalize the LLM markdown format with a versioned spec; optional `.mavisdraw/` folder synced to the repo via a GitHub Action.
7. **Embeds everywhere:** read-only interactive embed with drill-down (iframe), auto-updating SVG for READMEs, Notion/Confluence/Backstage plugins.
8. **MCP server** exposing `read_architecture`, `find_component`, `propose_update` so coding agents (Claude Code, Cursor, etc.) can consult and update the map. The LLM format in `packages/llm` is most of the work already.
9. **AI agent upgrades:** move to a current model (Claude Opus 5.5, `claude-opus-5-5`, is the current default; Sonnet 5.5 is the cheaper option if cost dominates — your call); keep the system prompt static and pass the diagram as a user/system message after a cache breakpoint so prompt caching works; use strict tool schemas for `propose_changes`; stream proposals as ghost previews on the canvas; let proposals target nested diagrams; per-user/org quotas and spend caps; an eval set of "repo → expected map" cases to measure quality as prompts change.

### Phase 3 — Teams (≈ 4–6 weeks)

- **Server-side version history** (shared, named versions, auto-snapshots), **visual diff** between versions ("what changed since last week"), restore.
- **Comments & @mentions** pinned to elements/regions, resolve threads, email/Slack notifications.
- **Workspaces/orgs**, invites by email, roles (owner/admin/editor/commenter/viewer), project folders, transfer ownership.
- **Presentation mode**: walk a guided path through zoom levels (great for onboarding docs and design reviews); improve follow-mode.
- **Offline**: queue edits with `y-indexeddb`, reconcile on reconnect.

### Phase 4 — Platform, growth & enterprise (ongoing, demand-driven)

- Landing page, template gallery (C4 starter, AWS reference architectures, microservices, event-driven), onboarding checklist.
- Billing (free / team / business), usage-based AI credits.
- SSO (SAML/OIDC), SCIM, audit log, data retention controls, SOC 2 path — **only when an enterprise pilot demands it** (Stage 7 of `PLAN.md` front-loaded this; defer it).
- Self-hosted Docker distribution (the compose file is most of the way there) — strong pull with the developer audience.
- Public REST API + webhooks, plugin/extension API.
- Horizontal scale: Hocuspocus Redis extension, Redis-backed rate limiting, CDN for assets.

---

## 7. Engineering foundations (cross-cutting)

- **Testing:** a real-backend e2e lane (Postgres in CI), two-client CRDT convergence tests, visual regression screenshots for the renderer, a perf benchmark (frame time at 1k/5k/10k elements) that fails CI on regression.
- **File format:** version `.mavisdraw` and the server JSON with explicit migrations (`version: 1` exists — add the migration path before the schema changes in Phase 2).
- **Type safety:** resolve the `BACKLOG.md` items (duplicate `AnchorPosition`, `as Partial<LinearElement>` casts, `'points' in el` checks) before the model layer lands on top of them.
- **Docs drift:** README claims e2e runs in CI and lists only 2 packages; update as part of Phase 0.

---

## 8. How to know it's working

| Stage      | Metric                                                        | Target                                     |
| ---------- | ------------------------------------------------------------- | ------------------------------------------ |
| Trust      | Data-loss / save-failure rate                                 | 0 known paths; save errors < 0.1% of saves |
| Trust      | Crash-free sessions (Sentry)                                  | > 99.5%                                    |
| Feel       | p95 frame time while panning a 2k-element diagram             | < 16 ms                                    |
| Feel       | Initial JS (gzip)                                             | < 300 KB                                   |
| Activation | New users who create a nested (2+ level) diagram in session 1 | > 30%                                      |
| Wedge      | Time from "connect repo" to an accepted multi-level map       | < 5 min                                    |
| Wedge      | % of active diagrams with ≥1 code link                        | rising                                     |
| Retention  | Teams active in week 4                                        | rising; drift-alert actions per team       |

## 9. What not to do (yet)

- Don't chase Miro's workshop features (timers, voting, sticky-note clustering).
- Don't build SSO/SCIM before there's a paying team asking.
- Don't build native mobile apps; make the web app touch-friendly instead.
- Don't add more export formats until import/export round-trips are tested for the ones that exist.

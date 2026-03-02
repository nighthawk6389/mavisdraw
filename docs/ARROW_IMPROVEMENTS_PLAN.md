# Arrow & Connector Improvements Plan

This document outlines a phased plan for upgrading arrow/connector functionality in MavisDraw to match the experience of tools like Miro, FigJam, and Excalidraw.

## Implementation Status

| Phase | Status | Notes |
|---|---|---|
| Phase 1 — Fix existing behavior | **COMPLETED** | Curved routing uses perpendicular offset, elbow handles aligned endpoints, hit testing samples Bézier curves |
| Phase 2 — Arrow property controls | **COMPLETED** | Arrowhead picker (start/end) in StylePanel, double-click arrow to cycle routing mode |
| Phase 3 — Edge-initiated connections | **COMPLETED** | Anchor points shown on hover, click-drag from anchor creates arrow, snap-to-anchor feedback |
| Phase 4 — Endpoint dragging & rebinding | **COMPLETED** | Green endpoint handles on selected arrows, drag to rebind to different shapes |
| Phase 5 — Midpoint manipulation | **COMPLETED** | Click + handle at segment midpoints to add waypoints, drag waypoints, double-click to remove |
| Phase 6 — Advanced elbow routing | Not started | Obstacle-aware routing, rounded corners (stretch goal) |

### Research Notes (Excalidraw / Miro / tldraw)

- **Excalidraw**: Uses click-click-click for multi-point arrows, `LinearElementEditor` for editing points after creation (Ctrl+double-click). Bézier curves with editable control points.
- **Miro**: Center-based snapping on drag, limited curve control. Users have requested Illustrator-like path tools.
- **tldraw**: `ElbowArrowMidpointHandle` for dragging elbow midpoint segments, velocity-based precision snapping.
- **Our approach**: Followed Excalidraw/tldraw patterns — waypoints via + handles at segment midpoints, endpoint handles for rebinding, anchor points on shape edges for connection initiation. Double-click on arrow cycles routing mode (discoverable without needing StylePanel). Double-click on waypoint removes it.

---

## Current State

### What exists today

| Capability | Status | Location |
|---|---|---|
| Arrow creation (drag from point A to B) | Working | `InteractionManager.ts` lines 155–460 |
| Three routing modes: straight, curved, elbow | Working | `CanvasRenderer.ts` lines 490–648 |
| Routing mode switcher in StylePanel | Working | `StylePanel.tsx` lines 216–248 |
| Auto-binding on creation (snap to nearby shape) | Working | `HitTesting.ts` `findBindingTarget`, `elementsStore.ts` `bindArrow` |
| Bound arrows follow shapes when dragged | Working | `elementsStore.ts` `moveElementWithBindings` |
| Arrowhead styles: none, arrow, triangle, dot, bar | Defined in types | `elements.ts` lines 86–94, rendered in `CanvasRenderer.ts` lines 703–829 |

### What's broken or missing

1. **Routing mode changes don't feel discoverable** — users must select the arrow first, then find the routing buttons in the StylePanel. There's no indication that the option exists.
2. **Curved arrows barely curve** — `getCubicControlPoints` uses `curvature: 0.5` but the control points are co-linear with the dominant axis, producing a subtle S-curve instead of a clear arc.
3. **Elbow arrows always bend** — `calculateElbowPoints` always creates an L-shaped mid-segment even when start and end are nearly aligned (should be a straight line).
4. **Hit testing misses curved/elbow paths** — `hitTestPolyline` tests against the straight line between points, not the actual rendered Bézier or elbow path.
5. **No edge-initiated connections** — you can't hover a shape, see anchor points on its edges, click one, and drag an arrow out to another shape.
6. **No endpoint dragging** — after an arrow is created, you can't grab an endpoint and reconnect it to a different shape.
7. **No arrowhead controls in StylePanel** — `startArrowhead` and `endArrowhead` are set at creation time only, with no UI to change them after.
8. **No midpoint manipulation** — arrows only have 2 points (start and end); you can't add waypoints to create complex paths.

---

## Phase 1 — Fix Existing Behavior (estimated: 1–2 days)

### 1.1 Improve curved routing

**Problem:** The current `getCubicControlPoints` in `packages/math/src/bezier.ts` places control points along the dominant axis, producing an almost-straight curve when start and end are roughly horizontal or vertical.

**Solution:**
- Add a perpendicular offset to control points so the curve visibly arcs away from the straight line.
- Scale the offset by the distance between endpoints (e.g., `offset = distance * curvature * 0.4`).
- Always offset perpendicular to the start–end line, not just along x or y.

```
Current:  S ------cp1------ cp2 ------ E   (barely bends)
Proposed: S ---___                ___--- E
                 \___cp1  cp2___/         (clear arc)
```

**Files to change:**
- `packages/math/src/bezier.ts` — `getCubicControlPoints`
- Unit tests in `packages/math/src/__tests__/`

### 1.2 Fix elbow routing for aligned endpoints

**Problem:** `calculateElbowPoints` always inserts a midpoint, even when start and end share the same x or y coordinate (i.e., they're already aligned and a straight segment would suffice).

**Solution:**
- If `|dx| < threshold` (e.g., 5px), return `[start, end]` directly (vertical line).
- If `|dy| < threshold`, return `[start, end]` directly (horizontal line).
- Otherwise, keep the current L-shape logic.
- Also add a small corner radius (optional) for a softer look.

**Files to change:**
- `apps/web/src/components/canvas/CanvasRenderer.ts` — `calculateElbowPoints`
- Unit tests

### 1.3 Fix hit testing for curved and elbow arrows

**Problem:** `hitTestPolyline` only tests against straight segments between points. Clicking on the visible curve of a curved arrow misses because the curve bows away from the straight-line path.

**Solution:**
- For `routingMode === 'curved'`: sample the cubic Bézier at ~20 intervals using `getCubicControlPoints` and test distance to the resulting polyline.
- For `routingMode === 'elbow'`: compute the actual elbow points via `calculateElbowPoints` and test distance to those segments.
- For `routingMode === 'straight'`: keep existing behavior.

**Files to change:**
- `apps/web/src/components/canvas/HitTesting.ts` — `hitTestPolyline`
- May need to import `getCubicControlPoints` and the elbow calculation
- Unit tests

---

## Phase 2 — Arrow Property Controls (estimated: 1 day)

### 2.1 Arrowhead picker in StylePanel

**Problem:** No UI to change `startArrowhead` or `endArrowhead` after creation.

**Solution:**
- Add an "Arrowheads" section in `StylePanel.tsx` when `hasLinearSelected` is true.
- Show two dropdown/button groups: one for start, one for end.
- Options: none, arrow, triangle, dot, bar (matches the existing `Arrowhead` type).
- Each button calls `updateElement(el.id, { startArrowhead: value })` for all selected linear elements.
- Include small SVG icons for each arrowhead style.

**Files to change:**
- `apps/web/src/components/toolbar/StylePanel.tsx`

### 2.2 Make routing mode more discoverable

**Options to consider:**
- Show a small routing-mode icon on the arrow itself when hovered or selected.
- Add a right-click context menu with routing options.
- Show routing mode buttons in a floating toolbar near the selected arrow.

**Recommendation:** Start with option (a) — display a small cycle icon at the midpoint of the selected arrow that, when clicked, cycles through straight → curved → elbow. This is how Excalidraw handles it.

**Files to change:**
- `apps/web/src/components/canvas/CanvasRenderer.ts` — render the midpoint icon
- `apps/web/src/components/canvas/HitTesting.ts` — hit test for the midpoint icon
- `apps/web/src/components/canvas/InteractionManager.ts` — handle the click

---

## Phase 3 — Edge-Initiated Connections (estimated: 2–3 days)

This is the "Miro-like" connector behavior: hover a shape, see anchor points, click-drag from one to create an arrow that snaps to another shape.

### 3.1 Hover anchor point indicators

**Behavior:**
- When the cursor hovers within ~20px of a shape's edge (and the active tool is `select` or `arrow`), display 4 anchor points (top, right, bottom, left center of the shape's bounding box).
- For ellipses/diamonds, place anchors at the actual edge points (using the shape's geometry).
- Anchors appear as small circles (6px radius, blue fill, white stroke).

**Implementation:**
- `CanvasRenderer.ts` — new method `renderAnchorPoints(ctx, element, hoveredAnchor)`.
- `HitTesting.ts` — new function `hitTestAnchorPoint(canvasPoint, element): AnchorPosition | null` where `AnchorPosition = 'top' | 'right' | 'bottom' | 'left'`.
- Anchor points are computed from element geometry: `getAnchorPoints(element): Point[]`.

**Files to change:**
- `apps/web/src/components/canvas/CanvasRenderer.ts`
- `apps/web/src/components/canvas/HitTesting.ts`
- `packages/types/src/elements.ts` — add `AnchorPosition` type

### 3.2 Click-drag from anchor to create arrow

**Behavior:**
1. User hovers a shape → anchors appear.
2. User presses on an anchor → enters `creating-from-anchor` mode.
3. System creates a new arrow with `startBinding` set to that shape.
4. As the user drags, the arrow's endpoint follows the cursor.
5. If the cursor nears another shape, that shape's anchors light up (snap preview).
6. On release near a target shape's anchor, the arrow's `endBinding` is set.
7. On release in empty space, the arrow ends at the cursor position (unbound).

**Implementation:**
- `InteractionManager.ts` — new mode `'creating-from-anchor'` or extend `'creating'` mode.
- Reuse existing `bindArrow` and `findBindingTarget` logic.
- The start point should be computed via `getBindingEdgePoint` so it stays on the shape's edge.
- During drag, re-render the preview arrow in the interactive layer.

**Files to change:**
- `apps/web/src/components/canvas/InteractionManager.ts`
- `apps/web/src/components/canvas/CanvasRenderer.ts` (preview rendering)
- `apps/web/src/stores/elementsStore.ts` (if anchor metadata needs storing)

### 3.3 Snap-to-anchor with visual feedback

**Behavior:**
- As the dragged arrow endpoint approaches a target shape, highlight the nearest anchor with a larger glow.
- Snap the endpoint to the anchor position.
- Show a dashed "connection preview" line from the arrow tip to the anchor.

**Files to change:**
- `apps/web/src/components/canvas/CanvasRenderer.ts` — render snap feedback
- `apps/web/src/components/canvas/InteractionManager.ts` — snap logic during drag

---

## Phase 4 — Endpoint Dragging & Rebinding (estimated: 1–2 days)

### 4.1 Endpoint handles for selected arrows

**Behavior:**
- When an arrow is selected, show circular handles at the start and end points (distinct from the bounding-box resize handles).
- Handles should be slightly larger (8px radius) and a different color (e.g., green) to differentiate from resize handles.

**Implementation:**
- `CanvasRenderer.ts` — `renderLinearEndpointHandles(ctx, element)`.
- `HitTesting.ts` — `hitTestEndpointHandle(canvasPoint, element): 'start' | 'end' | null`.
- Suppress normal resize handles when a linear element is selected; show endpoint handles instead.

### 4.2 Drag endpoint to rebind

**Behavior:**
1. User grabs the start or end handle of a selected arrow.
2. Enter `'rebinding'` mode in InteractionManager.
3. As the user drags, the endpoint follows the cursor.
4. `findBindingTarget` is checked continuously; if a target is found, snap and highlight.
5. On release: `unbindArrow` from old target (if any), `bindArrow` to new target (if any), update `points`.

**Implementation:**
- `InteractionManager.ts` — new mode `'rebinding-endpoint'` with `rebindingEnd: 'start' | 'end'`.
- Reuse `findBindingTarget`, `bindArrow`, `unbindArrow`.
- During drag, update `creatingElement` or a dedicated `rebindingPreview` for the interactive layer.

**Files to change:**
- `apps/web/src/components/canvas/InteractionManager.ts`
- `apps/web/src/components/canvas/CanvasRenderer.ts`
- `apps/web/src/components/canvas/HitTesting.ts`
- `apps/web/src/stores/elementsStore.ts`

---

## Phase 5 — Midpoint Manipulation (estimated: 2 days, optional/stretch)

### 5.1 Add waypoints to arrows

**Behavior:**
- When a straight or elbow arrow is selected, show a small `+` handle at the midpoint of each segment.
- Clicking the `+` handle inserts a new waypoint, splitting that segment in two.
- The user can then drag the waypoint to bend the arrow.

**Implementation:**
- Currently `points` is always `[[0,0], [dx,dy]]` (2 points). This would extend it to N points.
- Rendering already supports N-point polylines for straight mode.
- Elbow mode would need to recalculate right-angle routing between consecutive waypoints.
- Curved mode with waypoints would use piecewise cubic Bézier (one curve per segment).

### 5.2 Waypoint handles

- Render small diamond-shaped handles at each intermediate point.
- Hit test for waypoint handles in `HitTesting.ts`.
- Dragging a waypoint enters `'moving-waypoint'` mode in InteractionManager.
- Double-clicking a waypoint removes it (merges the two segments back).

**Files to change:**
- `apps/web/src/components/canvas/CanvasRenderer.ts`
- `apps/web/src/components/canvas/HitTesting.ts`
- `apps/web/src/components/canvas/InteractionManager.ts`
- `apps/web/src/stores/elementsStore.ts`

---

## Phase 6 — Advanced Elbow Routing (estimated: 2–3 days, optional/stretch)

### 6.1 Obstacle-aware routing

**Problem:** Current elbow routing is a simple L-shape that can overlap with other elements.

**Solution:**
- Implement an A* or grid-based pathfinding algorithm that routes around shapes.
- The routing area is defined by the bounding boxes of all visible elements with padding.
- This is a significant feature and should be treated as a stretch goal.

### 6.2 Rounded elbow corners

- Instead of sharp 90-degree turns, use `arcTo` or short Bézier curves at bend points.
- Add a `cornerRadius` property to `LinearElement` (default: 0, range: 0–20).
- Expose in StylePanel when an elbow arrow is selected.

---

## Testing Strategy

Each phase should include:

| Test Type | Coverage |
|---|---|
| **Unit tests** | Math utilities (Bézier sampling, elbow calculation, anchor point computation), hit testing functions, store mutations (bindArrow, unbindArrow, moveElementWithBindings) |
| **E2E tests** | Arrow creation with each routing mode, routing mode switching, endpoint dragging, edge-initiated connections, visual regression for curve rendering |

### Priority test scenarios

1. Create arrow → select it → change routing mode → verify visual change
2. Create arrow near a shape → verify auto-binding → move shape → verify arrow follows
3. Hover shape → see anchors → drag from anchor to another shape → verify binding
4. Select arrow → drag endpoint → drop on new shape → verify rebinding
5. Create curved arrow → click on the visible curve → verify selection (hit testing)
6. Create elbow arrow between vertically aligned shapes → verify straight line (no unnecessary bend)

---

## Implementation Order & Dependencies

```
Phase 1 (Fix existing)      ← No dependencies, start here
    ↓
Phase 2 (Property controls)  ← Independent of Phase 1
    ↓
Phase 3 (Edge connections)   ← Depends on Phase 1 (correct hit testing)
    ↓
Phase 4 (Endpoint dragging)  ← Depends on Phase 3 (anchor point infrastructure)
    ↓
Phase 5 (Midpoints)          ← Depends on Phase 4 (endpoint handle infrastructure)
    ↓
Phase 6 (Advanced routing)   ← Independent, stretch goal
```

Phases 1 and 2 can be done in parallel. Phases 3 and 4 build on each other. Phases 5 and 6 are stretch goals.

---

## Estimated Total Effort

| Phase | Effort | Priority |
|---|---|---|
| Phase 1 — Fix existing behavior | 1–2 days | **High** |
| Phase 2 — Arrow property controls | 1 day | **High** |
| Phase 3 — Edge-initiated connections | 2–3 days | **High** |
| Phase 4 — Endpoint dragging & rebinding | 1–2 days | **Medium** |
| Phase 5 — Midpoint manipulation | 2 days | **Low** |
| Phase 6 — Advanced elbow routing | 2–3 days | **Low** |
| **Total** | **9–13 days** | |

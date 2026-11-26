import type {
  Diagram,
  DiagramProposal,
  ElementType,
  MavisElement,
  PortalElement,
  TextElement,
} from '@mavisdraw/types';
import { useElementsStore } from '../../stores/elementsStore';
import { useDiagramStore } from '../../stores/diagramStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { registerNewDiagram } from '../../services/diagramSync';
import { computeLayout } from '../../layout/autoLayout';
import { connectElements, makeLabel } from '../../editor/elementFactory';
import { getCanvasController } from '../canvas/canvasController';
import { measureText } from '../../utils/fonts';

/** Style properties the model may change; anything else is ignored. */
const MODIFIABLE = new Set([
  'strokeColor',
  'backgroundColor',
  'fillStyle',
  'strokeStyle',
  'strokeWidth',
  'opacity',
]);

const ADDABLE = new Set<ElementType>(['rectangle', 'ellipse', 'diamond', 'portal']);

export interface ApplyResult {
  added: number;
  modified: number;
  deleted: number;
  connected: number;
}

function labelOf(el: MavisElement, elements: Map<string, MavisElement>): string | null {
  if (el.type === 'portal') return (el as PortalElement).label || null;
  for (const b of el.boundElements) {
    if (b.type !== 'text') continue;
    const t = elements.get(b.id) as TextElement | undefined;
    if (t && !t.isDeleted && t.text.trim()) return t.text.trim();
  }
  return null;
}

/**
 * Apply an AI proposal to the active diagram as a single undo step.
 * New shapes are laid out as a cluster beside the existing content (next to
 * the shapes they connect to), labels are resolved only within this diagram,
 * and portals the model adds get a real nested diagram to drill into.
 */
export async function applyProposal(proposal: DiagramProposal): Promise<ApplyResult> {
  const store = useElementsStore.getState();
  const diagramId = useDiagramStore.getState().activeDiagramId;
  const elements = store.elements;

  // Existing shapes in this diagram, addressable by id or (case-insensitive) label
  const existing = Array.from(elements.values()).filter(
    (el) =>
      el.diagramId === diagramId &&
      !el.isDeleted &&
      el.type !== 'text' &&
      el.type !== 'arrow' &&
      el.type !== 'line',
  );
  const byLabel = new Map<string, MavisElement>();
  for (const el of existing) {
    const label = labelOf(el, elements);
    if (label) byLabel.set(label.toLowerCase(), el);
  }
  const resolveExisting = (ref: string | undefined): MavisElement | undefined => {
    if (!ref) return undefined;
    const byId = elements.get(ref);
    if (byId && byId.diagramId === diagramId && !byId.isDeleted) return byId;
    return byLabel.get(ref.trim().toLowerCase());
  };

  // ── New shapes (built in memory, committed at the end) ──────────
  const created: MavisElement[] = [];
  const newByLabel = new Map<string, MavisElement>();
  const newShapes: MavisElement[] = [];
  const newDiagrams: Diagram[] = [];

  for (const change of proposal.changes) {
    if (change.action !== 'add') continue;
    const type = change.elementType as ElementType;
    if (!ADDABLE.has(type)) continue;
    const text = measureText(change.label, 20, 'hand-drawn', 1.25);
    const width = type === 'portal' ? 220 : Math.min(300, Math.max(140, text.width + 48));
    const height = type === 'portal' ? 130 : Math.max(70, text.height + 36);
    const shape = store.createElement(type, diagramId, 0, 0, width, height);

    if (type === 'portal') {
      const portal = shape as PortalElement;
      portal.label = change.label;
      const child = useDiagramStore.getState().createDiagram(diagramId, portal.id, change.label);
      portal.targetDiagramId = child.id;
      newDiagrams.push(child);
    } else {
      const label = makeLabel(diagramId, shape, change.label, 20);
      shape.boundElements = [{ id: label.id, type: 'text' }];
      created.push(label);
    }
    created.push(shape);
    newShapes.push(shape);
    newByLabel.set(change.label.trim().toLowerCase(), shape);
  }

  const resolve = (ref: string) =>
    newByLabel.get(ref.trim().toLowerCase()) ?? resolveExisting(ref);

  // ── Layout the new cluster beside what it connects to ───────────
  const connections = proposal.connections
    .map((c) => ({ conn: c, from: resolve(c.fromLabel), to: resolve(c.toLabel) }))
    .filter((c): c is { conn: typeof c.conn; from: MavisElement; to: MavisElement } => !!c.from && !!c.to && c.from.id !== c.to.id);

  if (newShapes.length > 0) {
    const newIds = new Set(newShapes.map((s) => s.id));
    const positions = await computeLayout(
      newShapes.map((s) => ({ id: s.id, width: s.width, height: s.height })),
      connections
        .filter((c) => newIds.has(c.from.id) && newIds.has(c.to.id))
        .map((c) => ({ from: c.from.id, to: c.to.id, labelled: !!c.conn.label })),
      'LR',
    );

    let originX: number;
    let originY: number;
    if (existing.length > 0) {
      const maxX = Math.max(...existing.map((e) => e.x + e.width));
      // Line up with the existing shapes the new ones connect to, if any
      const anchors = connections
        .flatMap((c) => [c.from, c.to])
        .filter((el) => !newIds.has(el.id));
      const anchorY =
        anchors.length > 0
          ? anchors.reduce((sum, a) => sum + a.y + a.height / 2, 0) / anchors.length
          : Math.min(...existing.map((e) => e.y)) + 60;
      let clusterH = 0;
      for (const s of newShapes) clusterH = Math.max(clusterH, positions.get(s.id)!.y + s.height);
      originX = maxX + 160;
      originY = anchorY - clusterH / 2;
    } else {
      const at = getCanvasController()?.getPasteAnchor() ?? { x: 0, y: 0 };
      let clusterW = 0;
      let clusterH = 0;
      for (const s of newShapes) {
        const p = positions.get(s.id)!;
        clusterW = Math.max(clusterW, p.x + s.width);
        clusterH = Math.max(clusterH, p.y + s.height);
      }
      originX = at.x - clusterW / 2;
      originY = at.y - clusterH / 2;
    }

    for (const s of newShapes) {
      const p = positions.get(s.id)!;
      s.x = Math.round(originX + p.x);
      s.y = Math.round(originY + p.y);
    }
    // Re-fit labels to the final positions
    for (const el of created) {
      if (el.type === 'text' && el.containerId) {
        const container = newShapes.find((s) => s.id === el.containerId);
        if (container) Object.assign(el, makeLabel(diagramId, container, el.text, el.fontSize), { id: el.id });
      }
    }
  }

  // ── Commit as one undo step ─────────────────────────────────────
  const result: ApplyResult = { added: newShapes.length, modified: 0, deleted: 0, connected: 0 };
  store.beginHistoryBatch();
  try {
    useElementsStore.setState((prev) => {
      const next = new Map(prev.elements);
      for (const el of created) next.set(el.id, el);
      return { elements: next };
    });

    // Connections (existing shapes are updated through the store so their
    // back-references stay consistent)
    for (const { conn, from, to } of connections) {
      const fromNow = useElementsStore.getState().elements.get(from.id)!;
      const toNow = useElementsStore.getState().elements.get(to.id)!;
      const fromCopy = { ...fromNow, boundElements: [...fromNow.boundElements] };
      const toCopy = { ...toNow, boundElements: [...toNow.boundElements] };
      const arrow = connectElements(diagramId, fromCopy, toCopy);
      const toAdd: MavisElement[] = [arrow];
      if (conn.label) {
        const label = makeLabel(diagramId, arrow, conn.label, 16);
        arrow.boundElements = [{ id: label.id, type: 'text' }];
        toAdd.push(label);
      }
      useElementsStore.setState((prev) => {
        const next = new Map(prev.elements);
        for (const el of toAdd) next.set(el.id, el);
        next.set(fromCopy.id, { ...fromCopy, version: fromCopy.version + 1, updatedAt: Date.now() });
        next.set(toCopy.id, { ...toCopy, version: toCopy.version + 1, updatedAt: Date.now() });
        return { elements: next };
      });
      result.connected++;
    }

    for (const change of proposal.changes) {
      if (change.action === 'modify') {
        const target = resolveExisting(change.elementId) ?? resolveExisting(change.label);
        if (!target) continue;
        const props: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(change.properties ?? {})) {
          if (MODIFIABLE.has(k)) props[k] = v;
        }
        if (Object.keys(props).length > 0) {
          useElementsStore.getState().updateElement(target.id, props as Partial<MavisElement>);
        }
        if (change.label) {
          if (target.type === 'portal') {
            useElementsStore.getState().updateElement(target.id, { label: change.label } as Partial<MavisElement>);
          } else {
            const labelRef = target.boundElements.find((b) => b.type === 'text');
            if (labelRef) {
              useElementsStore.getState().updateElement(labelRef.id, { text: change.label } as Partial<MavisElement>);
            }
          }
        }
        result.modified++;
      } else if (change.action === 'delete') {
        const target = resolveExisting(change.elementId);
        if (!target) continue;
        useElementsStore.getState().deleteElements([target.id]);
        result.deleted++;
      }
    }
  } finally {
    store.endHistoryBatch();
  }

  for (const d of newDiagrams) registerNewDiagram(useDiagramStore.getState().diagrams.get(d.id) ?? d);
  if (newShapes.length > 0) useSelectionStore.getState().selectMultiple(newShapes.map((s) => s.id));
  getCanvasController()?.invalidate();
  return result;
}

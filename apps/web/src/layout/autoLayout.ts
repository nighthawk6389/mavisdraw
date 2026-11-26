import type { LinearElement, MavisElement, Point } from '@mavisdraw/types';
import { useElementsStore } from '../stores/elementsStore';

export type LayoutDirection = 'TB' | 'BT' | 'LR' | 'RL';

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
}

export interface LayoutEdge {
  from: string;
  to: string;
  /** Labelled edges get more room between ranks. */
  labelled?: boolean;
}

/**
 * Layered (Sugiyama) layout via dagre, loaded on first use so it never
 * weighs down the editor bundle. Returns top-left positions with the
 * layout's bounding box starting at (0, 0).
 */
export async function computeLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  direction: LayoutDirection = 'TB',
): Promise<Map<string, Point>> {
  const result = new Map<string, Point>();
  if (nodes.length === 0) return result;

  const dagreModule = await import('@dagrejs/dagre');
  const dagre = (dagreModule as unknown as { default?: typeof dagreModule }).default ?? dagreModule;

  const anyLabels = edges.some((e) => e.labelled);
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir: direction,
    nodesep: 60,
    ranksep: anyLabels ? 110 : 80,
    edgesep: 20,
    marginx: 0,
    marginy: 0,
  });
  g.setDefaultEdgeLabel(() => ({}));

  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) g.setNode(n.id, { width: n.width, height: n.height });
  edges.forEach((e, i) => {
    if (ids.has(e.from) && ids.has(e.to) && e.from !== e.to) g.setEdge(e.from, e.to, {}, `e${i}`);
  });

  dagre.layout(g);

  let minX = Infinity;
  let minY = Infinity;
  for (const n of nodes) {
    const laid = g.node(n.id) as { x: number; y: number };
    const x = laid.x - n.width / 2;
    const y = laid.y - n.height / 2;
    result.set(n.id, { x, y });
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
  }
  for (const [id, p] of result) result.set(id, { x: p.x - minX, y: p.y - minY });
  return result;
}

const NODE_TYPES = new Set(['rectangle', 'ellipse', 'diamond', 'triangle', 'portal', 'image']);

/** Guess the flow direction of an existing diagram from its connectors. */
function inferDirection(nodes: Map<string, MavisElement>, arrows: LinearElement[]): LayoutDirection {
  let horizontal = 0;
  let vertical = 0;
  for (const a of arrows) {
    const from = nodes.get(a.startBinding!.elementId)!;
    const to = nodes.get(a.endBinding!.elementId)!;
    const dx = to.x + to.width / 2 - (from.x + from.width / 2);
    const dy = to.y + to.height / 2 - (from.y + from.height / 2);
    if (Math.abs(dx) > Math.abs(dy)) horizontal += dx >= 0 ? 1 : -1;
    else vertical += dy >= 0 ? 1 : -1;
  }
  if (Math.abs(horizontal) > Math.abs(vertical)) return horizontal >= 0 ? 'LR' : 'RL';
  return vertical >= 0 ? 'TB' : 'BT';
}

/**
 * "Tidy up": re-lay out the shapes of a diagram (or just `onlyIds`) along
 * their connections, as one undoable step. Labels and arrows follow their
 * shapes; connector bends are reset so routes stay clean.
 */
export async function tidyUpDiagram(
  diagramId: string,
  onlyIds?: Set<string>,
  direction?: LayoutDirection,
): Promise<boolean> {
  const all = useElementsStore.getState().elements;
  const nodes = new Map<string, MavisElement>();
  for (const el of all.values()) {
    if (el.diagramId !== diagramId || el.isDeleted || el.isLocked) continue;
    if (!NODE_TYPES.has(el.type)) continue;
    if (onlyIds && !onlyIds.has(el.id)) continue;
    nodes.set(el.id, el);
  }
  if (nodes.size < 2) return false;

  const arrows: LinearElement[] = [];
  for (const el of all.values()) {
    if (el.diagramId !== diagramId || el.isDeleted) continue;
    if (el.type !== 'arrow' && el.type !== 'line') continue;
    if (!el.startBinding || !el.endBinding) continue;
    if (!nodes.has(el.startBinding.elementId) || !nodes.has(el.endBinding.elementId)) continue;
    arrows.push(el);
  }

  const dir = direction ?? (arrows.length > 0 ? inferDirection(nodes, arrows) : 'TB');
  const positions = await computeLayout(
    Array.from(nodes.values()).map((n) => ({ id: n.id, width: n.width, height: n.height })),
    arrows.map((a) => ({
      from: a.startBinding!.elementId,
      to: a.endBinding!.elementId,
      labelled: a.boundElements.some((b) => b.type === 'text'),
    })),
    dir,
  );

  // Keep the layout where the content already was
  let originX = Infinity;
  let originY = Infinity;
  for (const n of nodes.values()) {
    originX = Math.min(originX, n.x);
    originY = Math.min(originY, n.y);
  }

  const updates: { id: string; changes: Partial<MavisElement> }[] = [];
  for (const [id, p] of positions) {
    updates.push({ id, changes: { x: originX + p.x, y: originY + p.y } });
  }
  // Straighten connectors; endpoints are re-glued to the moved shapes
  for (const a of arrows) {
    const first = a.points[0];
    const last = a.points[a.points.length - 1];
    updates.push({
      id: a.id,
      changes: { points: [first, last], elbowManualRoute: false } as Partial<MavisElement>,
    });
  }
  useElementsStore.getState().updateElements(updates);
  return true;
}

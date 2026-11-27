import type {
  Diagram,
  LinearElement,
  MavisElement,
  Point,
  PortalElement,
  RectangleElement,
  TextElement,
} from '@mavisdraw/types';
import type { MermaidGraph, MermaidNode, MermaidShape } from '@mavisdraw/compat';
import { useElementsStore } from '../stores/elementsStore';
import { useDiagramStore } from '../stores/diagramStore';
import { useSelectionStore } from '../stores/selectionStore';
import { registerNewDiagram } from '../services/diagramSync';
import { computeLayout, type LayoutDirection } from '../layout/autoLayout';
import { makeLabel, connectElements } from '../editor/elementFactory';
import { measureText } from '../utils/fonts';

/**
 * Turn a Mermaid flowchart into MavisDraw content inside the active diagram.
 *
 * The twist that makes this more than a format converter: every `subgraph`
 * becomes a portal you can drill into, so a flat README diagram becomes a
 * navigable, multi-level map. Links that cross subgraph boundaries are drawn
 * at the lowest level where both ends are visible (between the portals or
 * nodes that contain them), and every level is auto-laid out.
 */

type Level = string | null; // subgraph id, null = the diagram we import into

interface Entity {
  key: string; // node id or `sg:<subgraph id>`
  label: string;
  kind: 'node' | 'portal';
  shape?: MermaidShape;
  width: number;
  height: number;
}

interface LevelEdge {
  from: string;
  to: string;
  labels: string[];
  style: 'solid' | 'dotted' | 'thick';
  arrowStart: boolean;
  arrowEnd: boolean;
}

const PORTAL_SIZE = { width: 220, height: 130 };
const LABEL_FONT = 20;

function nodeSize(node: MermaidNode): { width: number; height: number } {
  const text = measureText(node.label, LABEL_FONT, 'hand-drawn', 1.25);
  let width = Math.min(300, Math.max(140, text.width + 48));
  let height = Math.max(70, text.height + 36);
  if (node.shape === 'diamond') {
    width *= 1.45;
    height *= 1.45;
  } else if (node.shape === 'circle') {
    const d = Math.max(width, height);
    width = d;
    height = d;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

/** Subgraph path from the top level down to (and including) `sg`. */
function ancestry(graph: MermaidGraph, sg: string | null): string[] {
  const path: string[] = [];
  let current = sg;
  while (current) {
    path.unshift(current);
    current = graph.subgraphs.get(current)?.parent ?? null;
  }
  return path;
}

/** Where an edge endpoint lives and what represents it at a given depth. */
function endpointPath(graph: MermaidGraph, id: string): { path: string[]; entity: string } {
  if (graph.subgraphs.has(id)) {
    const full = ancestry(graph, id);
    return { path: full.slice(0, -1), entity: `sg:${id}` };
  }
  const node = graph.nodes.get(id);
  return { path: ancestry(graph, node?.subgraph ?? null), entity: id };
}

function representative(
  info: { path: string[]; entity: string },
  depth: number,
): string {
  return info.path.length === depth ? info.entity : `sg:${info.path[depth]}`;
}

export interface MermaidImportResult {
  elements: number;
  diagrams: number;
  /** Subgraph id → the portal created for it. */
  portals: Map<string, string>;
}

export interface MermaidImportOptions {
  /** Extra fields for the portal of a subgraph (e.g. a link to its code). */
  portalExtras?: (subgraphId: string) => Partial<PortalElement> | undefined;
  /** The shape and icon for a node (e.g. a repo map's datastores). */
  nodeExtras?: (
    nodeId: string,
  ) => { type?: 'rectangle' | 'cylinder' | 'queue'; icon?: string } | undefined;
}

export async function importMermaidGraph(
  graph: MermaidGraph,
  at: Point,
  options: MermaidImportOptions = {},
): Promise<MermaidImportResult> {
  const diagramStore = useDiagramStore.getState();
  const store = useElementsStore.getState();
  const rootDiagramId = diagramStore.activeDiagramId;

  // ── Entities per level ─────────────────────────────────────────────
  const entitiesByLevel = new Map<Level, Entity[]>();
  const add = (level: Level, entity: Entity) => {
    const list = entitiesByLevel.get(level) ?? [];
    list.push(entity);
    entitiesByLevel.set(level, list);
  };
  for (const sg of graph.subgraphs.values()) {
    add(sg.parent, { key: `sg:${sg.id}`, label: sg.title, kind: 'portal', ...PORTAL_SIZE });
  }
  for (const node of graph.nodes.values()) {
    add(node.subgraph, { key: node.id, label: node.label, kind: 'node', shape: node.shape, ...nodeSize(node) });
  }

  // ── Edges, lifted to the lowest common level and de-duplicated ─────
  const edgesByLevel = new Map<Level, Map<string, LevelEdge>>();
  for (const edge of graph.edges) {
    const a = endpointPath(graph, edge.from);
    const b = endpointPath(graph, edge.to);
    let depth = 0;
    while (depth < a.path.length && depth < b.path.length && a.path[depth] === b.path[depth]) depth++;
    const level: Level = depth === 0 ? null : a.path[depth - 1];
    const from = representative(a, depth);
    const to = representative(b, depth);
    if (from === to) continue; // a link into its own container: nothing to draw here

    const levelEdges = edgesByLevel.get(level) ?? new Map<string, LevelEdge>();
    const key = `${from}→${to}`;
    const existing = levelEdges.get(key);
    if (existing) {
      if (edge.label && !existing.labels.includes(edge.label)) existing.labels.push(edge.label);
    } else {
      levelEdges.set(key, {
        from,
        to,
        labels: edge.label ? [edge.label] : [],
        style: edge.style,
        arrowStart: edge.arrowStart,
        arrowEnd: edge.arrowEnd,
      });
    }
    edgesByLevel.set(level, levelEdges);
  }

  // ── Diagrams: one child per subgraph, parents first ───────────────
  const diagramFor = new Map<Level, string>([[null, rootDiagramId]]);
  const portalIdFor = new Map<string, string>(); // subgraph id → portal element id
  const createdDiagrams: Diagram[] = [];
  for (const sg of graph.subgraphs.values()) {
    const parentDiagramId = diagramFor.get(sg.parent)!;
    const portalId = store.createElement('portal', parentDiagramId, 0, 0, 1, 1).id;
    portalIdFor.set(sg.id, portalId);
    const diagram = useDiagramStore.getState().createDiagram(parentDiagramId, portalId, sg.title);
    diagramFor.set(sg.id, diagram.id);
    createdDiagrams.push(diagram);
  }

  // ── Build elements level by level ─────────────────────────────────
  const created: MavisElement[] = [];
  const rootIds: string[] = [];

  for (const [level, entities] of entitiesByLevel) {
    const diagramId = diagramFor.get(level)!;
    const direction: LayoutDirection =
      (level ? graph.subgraphs.get(level)?.direction : null) ?? graph.direction;
    const levelEdges = Array.from(edgesByLevel.get(level)?.values() ?? []);
    const positions = await computeLayout(
      entities.map((e) => ({ id: e.key, width: e.width, height: e.height })),
      levelEdges.map((e) => ({ from: e.from, to: e.to, labelled: e.labels.length > 0 })),
      direction,
    );

    // Root content lands centred on the cursor; nested levels start at the origin
    let offsetX = 0;
    let offsetY = 0;
    if (level === null) {
      let maxX = 0;
      let maxY = 0;
      for (const e of entities) {
        const p = positions.get(e.key)!;
        maxX = Math.max(maxX, p.x + e.width);
        maxY = Math.max(maxY, p.y + e.height);
      }
      offsetX = at.x - maxX / 2;
      offsetY = at.y - maxY / 2;
    }

    const elementFor = new Map<string, MavisElement>();
    for (const entity of entities) {
      const p = positions.get(entity.key)!;
      const x = Math.round(p.x + offsetX);
      const y = Math.round(p.y + offsetY);

      if (entity.kind === 'portal') {
        const sgId = entity.key.slice(3);
        const portal: PortalElement = {
          ...(store.createElement('portal', diagramId, x, y, entity.width, entity.height) as PortalElement),
          ...options.portalExtras?.(sgId),
          id: portalIdFor.get(sgId)!,
          label: entity.label,
          targetDiagramId: diagramFor.get(sgId)!,
        };
        elementFor.set(entity.key, portal);
        created.push(portal);
        continue;
      }

      const extras = options.nodeExtras?.(entity.key);
      const type =
        extras?.type ??
        (entity.shape === 'circle'
          ? 'ellipse'
          : entity.shape === 'diamond'
            ? 'diamond'
            : entity.shape === 'cylinder'
              ? 'cylinder'
              : 'rectangle');
      const shape = store.createElement(type, diagramId, x, y, entity.width, entity.height);
      if (extras?.icon) shape.icon = extras.icon;
      if (type === 'rectangle') {
        const rounded = entity.shape === 'round' || entity.shape === 'stadium';
        (shape as RectangleElement).roundness = rounded ? 16 : 0;
      }
      const label = makeLabel(diagramId, shape, entity.label, LABEL_FONT);
      shape.boundElements = [{ id: label.id, type: 'text' }];
      elementFor.set(entity.key, shape);
      created.push(shape, label);
    }

    for (const edge of levelEdges) {
      const from = elementFor.get(edge.from);
      const to = elementFor.get(edge.to);
      if (!from || !to) continue;
      const arrow = connectElements(diagramId, from, to, edge);
      created.push(arrow);
      if (edge.labels.length > 0) {
        const label = makeLabel(diagramId, arrow, edge.labels.join(', '), 16);
        arrow.boundElements = [{ id: label.id, type: 'text' }];
        created.push(label);
      }
    }

    if (level === null) {
      for (const el of elementFor.values()) rootIds.push(el.id);
    }
  }

  // ── Commit as one undo step ──────────────────────────────────────
  store.pushHistory();
  useElementsStore.setState((prev) => {
    const next = new Map(prev.elements);
    for (const el of created) next.set(el.id, el);
    return { elements: next };
  });
  for (const diagram of createdDiagrams) {
    registerNewDiagram(useDiagramStore.getState().diagrams.get(diagram.id) ?? diagram);
  }
  useSelectionStore.getState().selectMultiple(rootIds);

  return { elements: created.length, diagrams: createdDiagrams.length, portals: new Map(portalIdFor) };
}


import type { Diagram, MavisElement, PortalElement, TextElement } from '@mavisdraw/types';
import type { TourStop } from '../services/api';

let seq = 0;
export function stopId(): string {
  seq += 1;
  return `stop-${Date.now().toString(36)}-${seq}`;
}

/** Names of the shapes on a diagram, as a person would read them (left→right, top→bottom). */
export function componentNames(elements: MavisElement[], diagramId: string, limit = 6): string[] {
  const live = elements.filter((e) => e.diagramId === diagramId && !e.isDeleted);
  const labels = new Map<string, string>();
  for (const el of live) {
    if (el.type === 'text' && (el as TextElement).containerId && (el as TextElement).text.trim()) {
      labels.set((el as TextElement).containerId!, (el as TextElement).text.trim());
    }
  }
  const named = live
    .filter((el) => el.type !== 'text' && el.type !== 'arrow' && el.type !== 'line')
    .map((el) => ({
      el,
      name: labels.get(el.id) ?? (el.type === 'portal' ? (el as PortalElement).label : ''),
    }))
    .filter((x) => x.name)
    .sort((a, b) => Math.round(a.el.y / 80) - Math.round(b.el.y / 80) || a.el.x - b.el.x);
  return named.slice(0, limit).map((x) => x.name);
}

function describe(elements: MavisElement[], diagram: Diagram, childTitles: string[]): string {
  const names = componentNames(elements, diagram.id);
  const parts: string[] = [];
  if (names.length) parts.push(names.join(', '));
  if (childTitles.length) parts.push(`Zooms into: ${childTitles.join(', ')}`);
  return parts.join(' — ');
}

/**
 * A guided walkthrough of the whole map: the top level first, then each
 * nested level depth-first, in the order its portal appears on the parent.
 * Every stop frames its diagram's content.
 */
export function generateTour(
  diagrams: Map<string, Diagram>,
  elements: MavisElement[],
  rootId: string,
): TourStop[] {
  const stops: TourStop[] = [];
  const seen = new Set<string>();

  const portalsOf = (diagramId: string) =>
    elements
      .filter(
        (e): e is PortalElement =>
          e.type === 'portal' &&
          e.diagramId === diagramId &&
          !e.isDeleted &&
          diagrams.has((e as PortalElement).targetDiagramId),
      )
      .sort((a, b) => Math.round(a.y / 80) - Math.round(b.y / 80) || a.x - b.x);

  const visit = (diagramId: string, depth: number) => {
    if (seen.has(diagramId) || depth > 12) return;
    seen.add(diagramId);
    const diagram = diagrams.get(diagramId);
    if (!diagram) return;
    const children = portalsOf(diagramId);
    stops.push({
      id: stopId(),
      diagramId,
      viewport: null,
      title: depth === 0 ? `${diagram.title} — overview` : diagram.title,
      note: describe(
        elements,
        diagram,
        children.map((p) => diagrams.get(p.targetDiagramId)!.title),
      ),
    });
    for (const portal of children) visit(portal.targetDiagramId, depth + 1);
  };

  visit(rootId, 0);
  return stops;
}

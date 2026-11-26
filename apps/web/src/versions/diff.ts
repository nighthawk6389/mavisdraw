import type { LinearElement, MavisElement, PortalElement, TextElement } from '@mavisdraw/types';

export type ChangeKind = 'added' | 'removed' | 'changed';

export interface ElementChange {
  id: string;
  kind: ChangeKind;
  /** The element as it is now (or as it was, for a removal). */
  element: MavisElement;
  /** Human-readable name: its label, text, or type. */
  name: string;
  /** What changed, in words ("Moved", 'Renamed "A" → "B"'). Empty for add/remove. */
  details: string[];
}

export interface DiagramDiff {
  changes: ElementChange[];
  added: number;
  removed: number;
  changed: number;
}

// Fields that change on every edit or are pure bookkeeping
const IGNORED = new Set(['version', 'updatedAt', 'seed', 'versionNonce', 'boundElements']);
const STYLE = new Set([
  'strokeColor',
  'backgroundColor',
  'fillStyle',
  'strokeWidth',
  'strokeStyle',
  'roughness',
  'opacity',
  'roundness',
  'fontSize',
  'fontFamily',
  'textAlign',
  'renderMode',
  'startArrowhead',
  'endArrowhead',
]);

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

const quote = (s: string) => `“${s.length > 40 ? `${s.slice(0, 39)}…` : s}”`;

/** Bound labels by container id. */
function labelsOf(elements: MavisElement[]): Map<string, TextElement> {
  const out = new Map<string, TextElement>();
  for (const el of elements) {
    if (el.type === 'text' && (el as TextElement).containerId) {
      out.set((el as TextElement).containerId!, el as TextElement);
    }
  }
  return out;
}

export function displayName(el: MavisElement, labels: Map<string, TextElement>): string {
  const label = labels.get(el.id)?.text?.trim();
  if (label) return label;
  if (el.type === 'portal' && (el as PortalElement).label) return (el as PortalElement).label;
  if (el.type === 'text' && (el as TextElement).text) return (el as TextElement).text;
  return el.type === 'portal' ? 'Nested diagram' : el.type[0].toUpperCase() + el.type.slice(1);
}

function describe(
  before: MavisElement,
  after: MavisElement,
  labelBefore: TextElement | undefined,
  labelAfter: TextElement | undefined,
): string[] {
  const b = before as unknown as Record<string, unknown>;
  const a = after as unknown as Record<string, unknown>;
  const changed = new Set<string>();
  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (!IGNORED.has(key) && !same(b[key], a[key])) changed.add(key);
  }

  const details: string[] = [];
  const oldName =
    labelBefore?.text ?? (before.type === 'portal' ? (before as PortalElement).label : undefined);
  const newName =
    labelAfter?.text ?? (after.type === 'portal' ? (after as PortalElement).label : undefined);
  if ((oldName ?? '') !== (newName ?? '')) {
    if (!oldName) details.push(`Labeled ${quote(newName!)}`);
    else if (!newName) details.push('Label removed');
    else details.push(`Renamed ${quote(oldName)} → ${quote(newName)}`);
  }
  if (after.type === 'text' && changed.has('text')) {
    details.push(`Text ${quote(String(b.text ?? ''))} → ${quote(String(a.text ?? ''))}`);
  }
  changed.delete('text');
  changed.delete('label');

  if (changed.has('x') || changed.has('y')) details.push('Moved');
  if (changed.has('width') || changed.has('height')) {
    if (!('points' in after) || !changed.has('points')) details.push('Resized');
  }
  if (changed.has('startBinding') || changed.has('endBinding')) details.push('Reconnected');
  else if (changed.has('points') || changed.has('waypoints') || changed.has('routingMode')) {
    details.push('Rerouted');
  }
  if ([...changed].some((k) => STYLE.has(k))) details.push('Restyled');
  if (changed.has('angle')) details.push('Rotated');
  if (changed.has('zIndex')) details.push('Reordered');
  if (changed.has('isLocked')) details.push(after.isLocked ? 'Locked' : 'Unlocked');
  if (changed.has('targetDiagramId')) details.push('Points to another diagram');

  const explained = new Set([
    'x',
    'y',
    'width',
    'height',
    'startBinding',
    'endBinding',
    'points',
    'waypoints',
    'routingMode',
    'angle',
    'zIndex',
    'isLocked',
    'targetDiagramId',
    ...STYLE,
  ]);
  if (details.length === 0 && [...changed].some((k) => !explained.has(k))) details.push('Edited');
  return details;
}

/**
 * What changed between two versions of a diagram, element by element.
 * Labels are folded into their shapes ("Renamed" rather than a separate text
 * change), so the list reads like what a person did.
 */
export function diffDiagrams(beforeAll: MavisElement[], afterAll: MavisElement[]): DiagramDiff {
  const before = beforeAll.filter((e) => !e.isDeleted);
  const after = afterAll.filter((e) => !e.isDeleted);
  const labelsBefore = labelsOf(before);
  const labelsAfter = labelsOf(after);
  const beforeById = new Map(before.map((e) => [e.id, e]));
  const afterById = new Map(after.map((e) => [e.id, e]));
  // A bound label belongs to its shape; only its container is listed
  const isBoundLabel = (el: MavisElement) =>
    el.type === 'text' && !!(el as TextElement).containerId;

  const changes: ElementChange[] = [];
  for (const el of after) {
    if (isBoundLabel(el)) continue;
    const old = beforeById.get(el.id);
    if (!old) {
      changes.push({
        id: el.id,
        kind: 'added',
        element: el,
        name: displayName(el, labelsAfter),
        details: [],
      });
      continue;
    }
    const details = describe(old, el, labelsBefore.get(el.id), labelsAfter.get(el.id));
    if (details.length > 0) {
      changes.push({
        id: el.id,
        kind: 'changed',
        element: el,
        name: displayName(el, labelsAfter),
        details,
      });
    }
  }
  for (const el of before) {
    if (isBoundLabel(el) || afterById.has(el.id)) continue;
    changes.push({
      id: el.id,
      kind: 'removed',
      element: el,
      name: displayName(el, labelsBefore),
      details: [],
    });
  }

  const order: Record<ChangeKind, number> = { added: 0, changed: 1, removed: 2 };
  changes.sort((x, y) => order[x.kind] - order[y.kind] || x.name.localeCompare(y.name));
  return {
    changes,
    added: changes.filter((c) => c.kind === 'added').length,
    removed: changes.filter((c) => c.kind === 'removed').length,
    changed: changes.filter((c) => c.kind === 'changed').length,
  };
}

/** Tight canvas-space bounds for highlighting (no culling padding). */
export function highlightBounds(el: MavisElement): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if ('points' in el && (el as LinearElement).points?.length) {
    const pts = (el as LinearElement).points;
    const xs = pts.map(([px]) => el.x + px);
    const ys = pts.map(([, py]) => el.y + py);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  }
  return { x: el.x, y: el.y, width: el.width, height: el.height };
}

/** One-line summary: "3 added · 1 removed · 2 changed". */
export function summarize(diff: DiagramDiff): string {
  const parts = [
    diff.added && `${diff.added} added`,
    diff.removed && `${diff.removed} removed`,
    diff.changed && `${diff.changed} changed`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No changes';
}

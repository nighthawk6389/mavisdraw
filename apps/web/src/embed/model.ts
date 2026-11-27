/**
 * The embed viewer's logic, kept free of the DOM so it's easy to test:
 * where a diagram sits in the nested map, and the pan/zoom math.
 */

export interface EmbedDiagram {
  id: string;
  title: string;
  parentDiagramId: string | null;
}

export interface EmbedOptions {
  token: string;
  /** Diagram to start on (default: the top-level map). */
  diagramId: string | null;
  theme: 'light' | 'dark' | 'auto';
}

/** `?t=<token>&d=<diagram>&theme=dark` → options, or null without a token. */
export function parseEmbedUrl(search: string): EmbedOptions | null {
  const params = new URLSearchParams(search);
  const token = params.get('t');
  if (!token || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const theme = params.get('theme');
  return {
    token,
    diagramId: params.get('d'),
    theme: theme === 'light' || theme === 'dark' ? theme : 'auto',
  };
}

/** Diagram ids from the top-level map down to `id` (just the root if unknown). */
export function ancestry(diagrams: EmbedDiagram[], id: string, rootId: string): string[] {
  const byId = new Map(diagrams.map((d) => [d.id, d]));
  if (!byId.has(id)) return [rootId];
  const path: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current.id);
    current = current.parentDiagramId ? byId.get(current.parentDiagramId) : undefined;
  }
  return path[0] === rootId ? path : [rootId, ...path];
}

export interface View {
  x: number;
  y: number;
  scale: number;
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/** Center content of size w×h in a viewport, as large as fits (never above 1.5×). */
export function fitView(w: number, h: number, viewW: number, viewH: number, margin = 16): View {
  if (w <= 0 || h <= 0) return { x: 0, y: 0, scale: 1 };
  const scale = clampScale(Math.min((viewW - margin * 2) / w, (viewH - margin * 2) / h, 1.5));
  return { x: (viewW - w * scale) / 2, y: (viewH - h * scale) / 2, scale };
}

/** Zoom by `factor`, keeping the point under the cursor where it is. */
export function zoomAt(view: View, factor: number, px: number, py: number): View {
  const scale = clampScale(view.scale * factor);
  const k = scale / view.scale;
  return { scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k };
}

import rough from 'roughjs';
import type {
  ImageElement,
  LinearElement,
  MavisElement,
  PortalElement,
  RectangleElement,
  TextElement,
} from '@mavisdraw/types';
import { computeElementsBounds } from './utils/bounds.js';
import { cylinderPaths, iconById, iconPlacement, queuePaths } from './library.js';

/**
 * A diagram as an SVG string, without a DOM: used by the server for README
 * images and by the embed viewer in the browser, so both look the same.
 *
 * Everything that comes from the diagram (colors, numbers, text) is
 * validated or escaped before it's written: these SVGs are served publicly,
 * and an SVG is a document that could otherwise carry script.
 */

export interface SvgMarkupOptions {
  /** Space around the content, in diagram units (default 24). */
  padding?: number;
  /** Hand-drawn (rough.js) or clean shapes (default: clean). */
  renderMode?: 'clean' | 'sketchy';
  /** Dark recolors default ink and the background for dark pages. */
  theme?: 'light' | 'dark';
  /** Paint a background behind the diagram (default true). */
  background?: boolean;
  /** Mark portals (data-portal / data-label) so a viewer can make them clickable. */
  portalHooks?: boolean;
  /** Cap the width attribute (the drawing scales down; viewBox is unchanged). */
  maxWidth?: number;
}

// ── Sanitizing ───────────────────────────────────────────────

const NAMED_COLOR = /^[a-z]{3,20}$/i;
const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;
const FUNC_COLOR = /^(rgb|rgba|hsl|hsla)\(\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*){2,3}\)$/i;

/** A CSS color we're willing to write into an attribute, or the fallback. */
export function safeColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const v = value.trim();
  return HEX_COLOR.test(v) || FUNC_COLOR.test(v) || NAMED_COLOR.test(v) ? v : fallback;
}

/** A finite number for an attribute (NaN, strings and huge values become safe). */
export function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-1e7, Math.min(1e7, Math.round(n * 100) / 100));
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Theme ────────────────────────────────────────────────────

interface Palette {
  background: string;
  portalFill: string;
  portalLabel: string;
  /** Dark default ink becomes light on dark pages; other colors stay. */
  ink: (color: string) => string;
}

function luminance(hex: string): number | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex.toLowerCase() === 'black' ? 0 : null;
  const full = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function palette(theme: 'light' | 'dark', background: string): Palette {
  if (theme === 'light') {
    return { background, portalFill: '#f0f4ff', portalLabel: '#4a5568', ink: (c) => c };
  }
  return {
    background: '#0d1117',
    portalFill: '#1c2433',
    portalLabel: '#c9d1d9',
    ink: (c) => {
      const l = luminance(c);
      return l !== null && l < 0.25 ? '#e6edf3' : c;
    },
  };
}

// ── Stacking ─────────────────────────────────────────────────

/** Bottom to top: zIndex, then insertion order; a label right above its container. */
function stacked(elements: MavisElement[]): MavisElement[] {
  const byId = new Map(elements.map((el) => [el.id, el]));
  const order = new Map(elements.map((el, i) => [el.id, i]));
  const key = (el: MavisElement): [number, number, number] => {
    const container =
      el.type === 'text' && (el as TextElement).containerId
        ? byId.get((el as TextElement).containerId!)
        : undefined;
    const anchor = container ?? el;
    return [anchor.zIndex ?? Number.NEGATIVE_INFINITY, order.get(anchor.id)!, container ? 1 : 0];
  };
  return [...elements].sort((a, b) => {
    const [za, ia, la] = key(a);
    const [zb, ib, lb] = key(b);
    return za !== zb ? (za < zb ? -1 : 1) : ia !== ib ? ia - ib : la - lb;
  });
}

// ── Shapes ───────────────────────────────────────────────────

interface Ctx {
  pal: Palette;
  sketchy: boolean;
  gen: ReturnType<typeof rough.generator> | null;
  portalHooks: boolean;
}

function strokeOf(el: MavisElement, ctx: Ctx) {
  return ctx.pal.ink(safeColor(el.strokeColor, '#1e1e1e'));
}

function fillOf(el: MavisElement): string | null {
  if (el.fillStyle === 'none') return null;
  const fill = safeColor(el.backgroundColor, 'transparent');
  return fill === 'transparent' ? null : fill;
}

function dash(el: MavisElement): string {
  if (el.strokeStyle === 'dashed') return ' stroke-dasharray="8 4"';
  if (el.strokeStyle === 'dotted') return ' stroke-dasharray="2 4"';
  return '';
}

function strokeAttrs(el: MavisElement, ctx: Ctx): string {
  return `stroke="${strokeOf(el, ctx)}" stroke-width="${num(el.strokeWidth)}"${dash(el)}`;
}

/** rough.js drawing → SVG paths (no DOM needed). */
function roughPaths(
  ctx: Ctx,
  draw: (gen: NonNullable<Ctx['gen']>, options: Record<string, unknown>) => unknown,
  el: MavisElement,
): string {
  const gen = ctx.gen!;
  const fill = fillOf(el);
  const options: Record<string, unknown> = {
    stroke: strokeOf(el, ctx),
    strokeWidth: num(el.strokeWidth),
    roughness: Math.max(0, Math.min(5, num(el.roughness))),
    seed: Math.abs(Math.trunc(num(el.seed))) || 1,
  };
  if (fill) {
    options.fill = fill;
    options.fillStyle = ['hachure', 'solid', 'zigzag', 'cross-hatch', 'dots'].includes(el.fillStyle)
      ? el.fillStyle
      : 'hachure';
  }
  if (el.strokeStyle === 'dashed') options.strokeLineDash = [8, 4];
  else if (el.strokeStyle === 'dotted') options.strokeLineDash = [2, 4];
  const drawable = draw(gen, options) as Parameters<typeof gen.toPaths>[0];
  return gen
    .toPaths(drawable)
    .map(
      (p) =>
        `<path d="${escapeXml(p.d)}" stroke="${safeColor(p.stroke, 'none')}" stroke-width="${num(p.strokeWidth)}" fill="${safeColor(p.fill, 'none')}"${dash(el)} />`,
    )
    .join('');
}

function shape(el: MavisElement, ctx: Ctx): string {
  const w = num(el.width);
  const h = num(el.height);
  const fill = fillOf(el);
  const fillAttr = `fill="${fill ?? 'none'}"`;
  switch (el.type) {
    case 'rectangle': {
      if (ctx.sketchy) return roughPaths(ctx, (g, o) => g.rectangle(0, 0, w, h, o), el);
      const r = num((el as RectangleElement).roundness);
      return `<rect width="${w}" height="${h}"${r > 0 ? ` rx="${r}"` : ''} ${fillAttr} ${strokeAttrs(el, ctx)} />`;
    }
    case 'ellipse':
      if (ctx.sketchy) return roughPaths(ctx, (g, o) => g.ellipse(w / 2, h / 2, w, h, o), el);
      return `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" ${fillAttr} ${strokeAttrs(el, ctx)} />`;
    case 'diamond': {
      const pts: [number, number][] = [
        [w / 2, 0],
        [w, h / 2],
        [w / 2, h],
        [0, h / 2],
      ];
      if (ctx.sketchy) return roughPaths(ctx, (g, o) => g.polygon(pts, o), el);
      return `<polygon points="${pts.map((p) => p.join(',')).join(' ')}" ${fillAttr} ${strokeAttrs(el, ctx)} />`;
    }
    case 'triangle': {
      const pts: [number, number][] = [
        [w / 2, 0],
        [w, h],
        [0, h],
      ];
      if (ctx.sketchy) return roughPaths(ctx, (g, o) => g.polygon(pts, o), el);
      return `<polygon points="${pts.map((p) => p.join(',')).join(' ')}" ${fillAttr} ${strokeAttrs(el, ctx)} />`;
    }
    case 'cylinder':
    case 'queue': {
      const { body, rim } = el.type === 'cylinder' ? cylinderPaths(w, h) : queuePaths(w, h);
      if (ctx.sketchy) {
        return (
          roughPaths(ctx, (g, o) => g.path(body, o), el) +
          roughPaths(ctx, (g, o) => g.path(rim, { ...o, fill: undefined }), {
            ...el,
            fillStyle: 'none',
          })
        );
      }
      return (
        `<path d="${body}" ${fillAttr} ${strokeAttrs(el, ctx)} />` +
        `<path d="${rim}" fill="none" ${strokeAttrs(el, ctx)} />`
      );
    }
    case 'line':
    case 'arrow':
      return linear(el as LinearElement, ctx);
    case 'freedraw': {
      const pts = (el as LinearElement).points.map(
        ([x, y]) => [num(x), num(y)] as [number, number],
      );
      if (pts.length < 2) return '';
      const d = `M ${pts.map((p) => p.join(' ')).join(' L ')}`;
      return `<path d="${d}" fill="none" ${strokeAttrs(el, ctx)} stroke-linecap="round" stroke-linejoin="round" />`;
    }
    case 'text':
      return text(el as TextElement, ctx);
    case 'portal':
      return portal(el as PortalElement, ctx);
    case 'image':
      return image(el as ImageElement);
    default:
      return '';
  }
}

/** The shape's icon, if it has one we know, in its stroke colour. */
function icon(el: MavisElement, ctx: Ctx): string {
  const def = iconById(el.icon);
  const at = def && iconPlacement({ type: el.type, width: num(el.width), height: num(el.height) });
  if (!def || !at) return '';
  const scale = num(at.size / 24);
  return (
    `<g transform="translate(${num(at.x)} ${num(at.y)}) scale(${scale})" fill="none" stroke="${strokeOf(el, ctx)}" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    def.paths.map((d) => `<path d="${escapeXml(d)}" />`).join('') +
    '</g>'
  );
}

function linear(el: LinearElement, ctx: Ctx): string {
  const pts = el.points.map(([x, y]) => [num(x), num(y)] as [number, number]);
  if (pts.length < 2) return '';
  let body: string;
  if (el.routingMode === 'curved' && pts.length === 2) {
    const [[sx, sy], [ex, ey]] = pts;
    const dx = ex - sx;
    const dy = ey - sy;
    const dist = Math.hypot(dx, dy) || 1;
    const cx = (sx + ex) / 2 + (-dy / dist) * dist * 0.2;
    const cy = (sy + ey) / 2 + (dx / dist) * dist * 0.2;
    body = ctx.sketchy
      ? roughPaths(
          ctx,
          (g, o) =>
            g.curve(
              [
                [sx, sy],
                [cx, cy],
                [ex, ey],
              ],
              o,
            ),
          el,
        )
      : `<path d="M ${sx} ${sy} Q ${num(cx)} ${num(cy)} ${ex} ${ey}" fill="none" ${strokeAttrs(el, ctx)} />`;
  } else {
    body = ctx.sketchy
      ? roughPaths(ctx, (g, o) => g.linearPath(pts, o), el)
      : `<path d="M ${pts.map((p) => p.join(' ')).join(' L ')}" fill="none" ${strokeAttrs(el, ctx)} />`;
  }
  if (el.type !== 'arrow') return body;
  return body + arrowhead(el, pts, 'end', ctx) + arrowhead(el, pts, 'start', ctx);
}

function arrowhead(
  el: LinearElement,
  pts: [number, number][],
  end: 'start' | 'end',
  ctx: Ctx,
): string {
  const kind = end === 'end' ? el.endArrowhead : el.startArrowhead;
  if (!kind || kind === 'none') return '';
  const [tip, from] = end === 'end' ? [pts[pts.length - 1], pts[pts.length - 2]] : [pts[0], pts[1]];
  const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const len = Math.max(num(el.strokeWidth) * 3, 10);
  const color = strokeOf(el, ctx);
  const sw = num(el.strokeWidth);
  if (kind === 'arrow' || kind === 'triangle') {
    const a = [
      tip[0] - len * Math.cos(angle - Math.PI / 6),
      tip[1] - len * Math.sin(angle - Math.PI / 6),
    ];
    const b = [
      tip[0] - len * Math.cos(angle + Math.PI / 6),
      tip[1] - len * Math.sin(angle + Math.PI / 6),
    ];
    const fill = kind === 'triangle' ? color : 'none';
    return `<polygon points="${tip.join(',')} ${a.map(num).join(',')} ${b.map(num).join(',')}" fill="${fill}" stroke="${color}" stroke-width="${sw}" stroke-linejoin="round" />`;
  }
  if (kind === 'dot') {
    return `<circle cx="${tip[0]}" cy="${tip[1]}" r="${num(len / 2)}" fill="${color}" />`;
  }
  if (kind === 'bar') {
    const p = angle + Math.PI / 2;
    const half = len / 2;
    return `<line x1="${num(tip[0] + half * Math.cos(p))}" y1="${num(tip[1] + half * Math.sin(p))}" x2="${num(tip[0] - half * Math.cos(p))}" y2="${num(tip[1] - half * Math.sin(p))}" stroke="${color}" stroke-width="${sw}" />`;
  }
  return '';
}

/** Same stacks as the editor (apps/web/src/utils/fonts.ts). */
const FONTS: Record<string, string> = {
  'hand-drawn': "'Architects Daughter', 'Segoe Print', 'Comic Sans MS', cursive",
  monospace: "'Cascadia Code', 'Fira Code', Menlo, Consolas, monospace",
};
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";

/** Rough text width without a font engine (good enough for a label's backdrop). */
function approxWidth(line: string, size: number, family: string): number {
  return line.length * size * (family === 'sans-serif' ? 0.55 : 0.6);
}

/** Where a connector's label sits: the middle of the route as drawn. */
function connectorMidpoint(el: LinearElement): [number, number] {
  const pts = el.points.map(([x, y]) => [num(x), num(y)] as [number, number]);
  const ox = num(el.x);
  const oy = num(el.y);
  if (pts.length < 2) return [ox, oy];
  if (el.routingMode === 'curved' && pts.length === 2) {
    const [[sx, sy], [ex, ey]] = pts;
    const dx = ex - sx;
    const dy = ey - sy;
    const dist = Math.hypot(dx, dy) || 1;
    const cx = (sx + ex) / 2 + (-dy / dist) * dist * 0.2;
    const cy = (sy + ey) / 2 + (dx / dist) * dist * 0.2;
    // Quadratic Bézier at t = 0.5
    return [ox + (sx + 2 * cx + ex) / 4, oy + (sy + 2 * cy + ey) / 4];
  }
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (walked + len >= total / 2 && len > 0) {
      const t = (total / 2 - walked) / len;
      return [
        ox + pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
        oy + pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t,
      ];
    }
    walked += len;
  }
  return [ox + pts[0][0], oy + pts[0][1]];
}

/** A connector's label, centred on its route, on a backdrop so the line doesn't cross it. */
function connectorLabel(label: TextElement, connector: LinearElement, ctx: Ctx): string {
  const lines = String(label.text ?? '').split('\n');
  if (!lines.some((l) => l.trim())) return '';
  const size = num(label.fontSize) || 16;
  const lineHeight = size * (num(label.lineHeight) || 1.25);
  const [mx, my] = connectorMidpoint(connector);
  const width = Math.max(...lines.map((l) => approxWidth(l, size, label.fontFamily)));
  const height = lines.length * lineHeight;
  const family = FONTS[label.fontFamily] ?? SANS;
  const tspans = lines
    .map(
      (line, i) =>
        `<tspan x="${num(mx)}" y="${num(my - height / 2 + size + i * lineHeight - size * 0.2)}">${escapeXml(line)}</tspan>`,
    )
    .join('');
  return (
    `<rect x="${num(mx - width / 2 - 6)}" y="${num(my - height / 2 - 2)}" width="${num(width + 12)}" height="${num(height + 4)}" rx="4" fill="${ctx.pal.background}" />` +
    `<text font-family="${family}" font-size="${size}" fill="${strokeOf(label, ctx)}" text-anchor="middle">${tspans}</text>`
  );
}

function text(el: TextElement, ctx: Ctx): string {
  const size = num(el.fontSize) || 16;
  const lineHeight = size * (num(el.lineHeight) || 1.25);
  const lines = String(el.text ?? '').split('\n');
  const w = num(el.width);
  const h = num(el.height);
  const [anchor, x] =
    el.textAlign === 'center'
      ? ['middle', w / 2]
      : el.textAlign === 'right'
        ? ['end', w]
        : ['start', 0];
  const total = lines.length * lineHeight;
  const top =
    el.verticalAlign === 'middle' ? (h - total) / 2 : el.verticalAlign === 'bottom' ? h - total : 0;
  const tspans = lines
    .map(
      (line, i) =>
        `<tspan x="${num(x)}" y="${num(top + size + i * lineHeight)}">${escapeXml(line)}</tspan>`,
    )
    .join('');
  const family = FONTS[el.fontFamily] ?? SANS;
  return `<text font-family="${family}" font-size="${size}" fill="${strokeOf(el, ctx)}" text-anchor="${anchor}">${tspans}</text>`;
}

function portal(el: PortalElement, ctx: Ctx): string {
  const w = num(el.width);
  const h = num(el.height);
  const fill = safeColor(el.backgroundColor, 'transparent');
  const parts = [
    `<rect width="${w}" height="${h}" rx="10" fill="${fill === 'transparent' ? ctx.pal.portalFill : fill}" ${strokeAttrs(el, ctx)} />`,
    // A second card peeking out behind: "there's more inside"
    `<path d="M 8 ${h + 4} L ${w - 8} ${h + 4}" stroke="${strokeOf(el, ctx)}" stroke-width="1" opacity="0.5" />`,
  ];
  if (el.label) {
    parts.push(
      `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" dominant-baseline="central" font-family="${SANS}" font-size="15" font-weight="600" fill="${ctx.pal.portalLabel}">${escapeXml(el.label)}</text>`,
    );
  }
  return parts.join('');
}

/** Inline (data:) images only: external URLs would be fetched by whoever views the SVG. */
function image(el: ImageElement): string {
  const url = typeof el.imageUrl === 'string' ? el.imageUrl : '';
  if (!/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(url)) return '';
  return `<image width="${num(el.width)}" height="${num(el.height)}" href="${url}" preserveAspectRatio="none" />`;
}

function transform(el: MavisElement): string {
  const x = num(el.x);
  const y = num(el.y);
  const angle = num(el.angle);
  if (!angle) return `translate(${x} ${y})`;
  const w = num(el.width);
  const h = num(el.height);
  const deg = num((angle * 180) / Math.PI);
  return `translate(${num(x + w / 2)} ${num(y + h / 2)}) rotate(${deg}) translate(${num(-w / 2)} ${num(-h / 2)})`;
}

// ── Document ─────────────────────────────────────────────────

/**
 * Elements come as clients stored them: arrays the drawing reads are given
 * a usable shape, so one malformed element can't fail the whole picture.
 */
function drawable(el: MavisElement): MavisElement {
  const fix: Record<string, unknown> = {};
  if (!Array.isArray(el.boundElements)) fix.boundElements = [];
  if (el.type === 'line' || el.type === 'arrow' || el.type === 'freedraw') {
    const points = (el as { points?: unknown }).points;
    if (!Array.isArray(points) || !points.every((p) => Array.isArray(p) && p.length >= 2)) {
      fix.points = Array.isArray(points)
        ? points.filter((p) => Array.isArray(p) && p.length >= 2)
        : [];
    }
  }
  return Object.keys(fix).length > 0 ? ({ ...el, ...fix } as MavisElement) : el;
}

export function renderSvgMarkup(
  elements: MavisElement[],
  options: SvgMarkupOptions & { backgroundColor?: string } = {},
): string {
  const live = elements.filter((el) => !el.isDeleted).map(drawable);
  const padding = options.padding ?? 24;
  const theme = options.theme ?? 'light';
  const pal = palette(theme, safeColor(options.backgroundColor, '#ffffff'));
  const sketchy = options.renderMode === 'sketchy';
  const ctx: Ctx = {
    pal,
    sketchy,
    gen: sketchy ? rough.generator() : null,
    portalHooks: !!options.portalHooks,
  };

  const bounds = computeElementsBounds(live);
  const x = num((bounds?.x ?? 0) - padding);
  const y = num((bounds?.y ?? 0) - padding);
  const w = num((bounds?.width ?? 200) + padding * 2);
  // Room for the portals' "more inside" line under the lowest card
  const h = num((bounds?.height ?? 100) + padding * 2 + 6);
  const width = options.maxWidth && w > options.maxWidth ? options.maxWidth : w;
  const height = num((h * width) / w);

  const byId = new Map(live.map((el) => [el.id, el]));
  const body = stacked(live)
    .map((el) => {
      const container =
        el.type === 'text' && (el as TextElement).containerId
          ? byId.get((el as TextElement).containerId!)
          : undefined;
      if (container && (container.type === 'arrow' || container.type === 'line')) {
        const label = connectorLabel(el as TextElement, container as LinearElement, ctx);
        const opacity = num(el.opacity);
        return label
          ? `<g${opacity < 100 ? ` opacity="${num(opacity / 100)}"` : ''}>${label}</g>`
          : '';
      }
      const inner = shape(el, ctx) + icon(el, ctx);
      if (!inner) return '';
      const opacity = num(el.opacity);
      const attrs = [`transform="${transform(el)}"`];
      if (opacity < 100) attrs.push(`opacity="${num(opacity / 100)}"`);
      if (el.type === 'portal' && ctx.portalHooks) {
        const p = el as PortalElement;
        attrs.push(
          `data-portal="${escapeXml(p.targetDiagramId ?? '')}"`,
          `data-label="${escapeXml(p.label ?? '')}"`,
          'class="portal"',
        );
      }
      return `<g ${attrs.join(' ')}>${inner}</g>`;
    })
    .join('');

  const background =
    options.background === false
      ? ''
      : `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${pal.background}" />`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${num(width)}" height="${height}">` +
    background +
    body +
    '</svg>'
  );
}

import type { Point } from '@mavisdraw/types';

/**
 * Auto-pan while dragging near (or past) the edge of the canvas, as in tldraw
 * (`EdgeScrollManager`) and Miro: after a short delay the view scrolls toward
 * the pointer, faster the closer it gets to (or the further past) the edge,
 * easing in so it never jerks.
 */

export interface EdgeScrollOptions {
  /** Width of the band along each edge that triggers scrolling, in screen px. */
  band: number;
  /** Top speed in screen px per 60 Hz frame. */
  speed: number;
  /** How long the pointer must stay in the band before scrolling starts, ms. */
  delay: number;
  /** Ease-in time after the delay, ms. */
  easeIn: number;
}

export const EDGE_SCROLL_DEFAULTS: EdgeScrollOptions = {
  band: 32,
  speed: 18,
  delay: 150,
  easeIn: 250,
};

/** Proximity along one axis: -1…1 (negative = toward the start edge), 0 outside the band. */
function proximity(position: number, size: number, band: number): number {
  if (size <= band * 2) return 0;
  if (position < band) return -Math.min(1, (band - position) / band);
  if (position > size - band) return Math.min(1, (position - (size - band)) / band);
  return 0;
}

/** Direction and strength of edge scrolling for a pointer at `pointer` (canvas-relative px). */
export function edgeProximity(
  pointer: Point,
  size: { width: number; height: number },
  band = EDGE_SCROLL_DEFAULTS.band,
): Point {
  return {
    x: proximity(pointer.x, size.width, band),
    y: proximity(pointer.y, size.height, band),
  };
}

/**
 * How far the *view* should move this frame (screen px; positive x means
 * reveal more to the right). `inBandMs` is how long the pointer has been in
 * the band, `elapsedMs` the frame time.
 */
export function edgeScrollStep(
  pointer: Point,
  size: { width: number; height: number },
  inBandMs: number,
  elapsedMs: number,
  options: EdgeScrollOptions = EDGE_SCROLL_DEFAULTS,
): Point {
  const p = edgeProximity(pointer, size, options.band);
  if ((p.x === 0 && p.y === 0) || inBandMs < options.delay) return { x: 0, y: 0 };
  const t = options.easeIn > 0 ? Math.min(1, (inBandMs - options.delay) / options.easeIn) : 1;
  const eased = t * t * t; // ease-in cubic, like tldraw
  const perFrame = options.speed * eased * (Math.min(elapsedMs, 50) / (1000 / 60));
  return { x: p.x * perFrame, y: p.y * perFrame };
}

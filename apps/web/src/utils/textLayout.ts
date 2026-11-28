import type { FontFamily } from '@mavisdraw/types';
import { cssFont } from './fonts';

/**
 * Wrap text to a width, word by word, as the canvas draws a label: each
 * paragraph (line break) on its own lines, a word too long for the width
 * left whole on its own line. The renderer and label sizing share this, so
 * what's measured is what's drawn.
 */
export function wrapLines(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let current = '';
    for (const word of paragraph.split(' ')) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && measure(candidate) > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }
  return lines;
}

let measureCtx: CanvasRenderingContext2D | null | undefined;

/** How tall a label's text is once wrapped to `maxWidth` (canvas units). */
export function wrappedTextHeight(
  text: string,
  maxWidth: number,
  fontSize: number,
  family: FontFamily | string | undefined,
  lineHeight: number,
): number {
  if (measureCtx === undefined) {
    measureCtx =
      typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  }
  const ctx = measureCtx;
  const measure = ctx
    ? (s: string) => {
        ctx.font = cssFont(fontSize, family);
        return ctx.measureText(s).width;
      }
    : (s: string) => s.length * fontSize * 0.6;
  return wrapLines(text, maxWidth, measure).length * fontSize * lineHeight;
}

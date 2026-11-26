import '@fontsource/architects-daughter/latin-400.css';
import type { FontFamily } from '@mavisdraw/types';

/**
 * Single source of truth for the CSS font stacks behind each FontFamily.
 * The canvas renderer, the inline text editor, text measurement and SVG
 * export must all agree, or text boxes are sized for one font and drawn
 * in another.
 *
 * The hand-drawn face is bundled (not left to the OS) so every
 * collaborator sees and measures the same glyphs.
 */
export const HAND_DRAWN_FONT = 'Architects Daughter';

const FONT_STACKS: Record<FontFamily, string> = {
  'hand-drawn': `"${HAND_DRAWN_FONT}", "Segoe Print", "Comic Sans MS", cursive`,
  'sans-serif': '"Helvetica Neue", Helvetica, Arial, sans-serif',
  monospace: '"Cascadia Code", "Fira Code", Menlo, Consolas, monospace',
};

export function fontStack(family: FontFamily | string | undefined): string {
  return FONT_STACKS[(family as FontFamily) ?? 'sans-serif'] ?? FONT_STACKS['sans-serif'];
}

export function cssFont(fontSize: number, family: FontFamily | string | undefined): string {
  return `${fontSize}px ${fontStack(family)}`;
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** Measure the widest line and total height of a block of text. */
export function measureText(
  text: string,
  fontSize: number,
  family: FontFamily | string | undefined,
  lineHeight: number,
): { width: number; height: number } {
  if (!measureCtx && typeof document !== 'undefined') {
    measureCtx = document.createElement('canvas').getContext('2d');
  }
  const lines = text.split('\n');
  let width = 0;
  if (measureCtx) {
    measureCtx.font = cssFont(fontSize, family);
    for (const line of lines) width = Math.max(width, measureCtx.measureText(line).width);
  } else {
    width = Math.max(...lines.map((l) => l.length)) * fontSize * 0.6;
  }
  return { width, height: lines.length * fontSize * lineHeight };
}

/**
 * Resolve once the bundled faces are ready, so the first canvas paint (and
 * text measurement) use the real glyphs instead of a fallback.
 */
export function whenFontsReady(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts?.load) return Promise.resolve();
  return document.fonts
    .load(`20px "${HAND_DRAWN_FONT}"`)
    .then(() => undefined)
    .catch(() => undefined);
}

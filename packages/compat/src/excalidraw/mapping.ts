import type { FontFamily, Arrowhead } from '@mavisdraw/types';

/** Excalidraw fontFamily (number) → MavisDraw FontFamily (string) */
export const FONT_FAMILY_MAP: Record<number, FontFamily> = {
  1: 'hand-drawn',
  2: 'sans-serif',
  3: 'monospace',
};

/** MavisDraw FontFamily (string) → Excalidraw fontFamily (number) */
export const FONT_FAMILY_REVERSE: Record<FontFamily, number> = {
  'hand-drawn': 1,
  'sans-serif': 2,
  monospace: 3,
};

/** Convert Excalidraw roundness object to a MavisDraw numeric roundness. */
export function excalidrawRoundnessToMavis(
  roundness: { type: number; value?: number } | null,
): number {
  if (!roundness) return 0;
  // Excalidraw type 3 = proportional rounding
  if (roundness.type === 3) return roundness.value ?? 8;
  if (roundness.type === 2) return roundness.value ?? 4;
  return 0;
}

/** Convert MavisDraw numeric roundness to Excalidraw roundness object. */
export function mavisRoundnessToExcalidraw(
  roundness: number,
): { type: number } | null {
  if (roundness <= 0) return null;
  return { type: 3 };
}

/** Map Excalidraw arrowhead string to MavisDraw Arrowhead type. */
export function mapArrowheadToMavis(arrowhead: string | null | undefined): Arrowhead {
  if (!arrowhead) return 'none';
  switch (arrowhead) {
    case 'arrow':
      return 'arrow';
    case 'dot':
      return 'dot';
    case 'bar':
      return 'bar';
    case 'triangle':
      return 'triangle';
    default:
      return 'arrow';
  }
}

/** Map MavisDraw Arrowhead to Excalidraw arrowhead string. */
export function mapArrowheadToExcalidraw(arrowhead: Arrowhead): string | null {
  if (arrowhead === 'none') return null;
  return arrowhead; // Direct 1:1 mapping
}

/** Map Excalidraw fillStyle to MavisDraw (drop 'zigzag' → 'hachure'). */
export function mapFillStyle(
  fillStyle: string,
): 'solid' | 'hachure' | 'cross-hatch' | 'none' {
  switch (fillStyle) {
    case 'solid':
      return 'solid';
    case 'hachure':
      return 'hachure';
    case 'cross-hatch':
      return 'cross-hatch';
    case 'zigzag':
      return 'hachure'; // Closest equivalent
    default:
      return 'hachure';
  }
}

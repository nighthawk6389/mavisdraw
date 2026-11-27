import type { MavisElement, PortalElement, TextElement } from '@mavisdraw/types';

/** Text bound inside a shape (its label), if any. */
export function getBoundText(
  el: MavisElement,
  elementMap: Map<string, MavisElement>,
): string | null {
  for (const bound of el.boundElements) {
    if (bound.type === 'text') {
      const textEl = elementMap.get(bound.id) as TextElement | undefined;
      if (textEl?.text) return textEl.text.trim();
    }
  }
  return null;
}

/** What people call an element: its text, portal label or bound label. */
export function getElementLabel(el: MavisElement, elementMap: Map<string, MavisElement>): string {
  if (el.type === 'text') {
    return (el as TextElement).text.trim() || 'Unnamed';
  }
  if (el.type === 'portal') {
    return (el as PortalElement).label || 'Unnamed Portal';
  }
  const boundText = getBoundText(el, elementMap);
  if (boundText) return boundText;
  // Fallback to type + truncated id
  return `${el.type}_${el.id.slice(0, 6)}`;
}

/** The label a person gave an element, or null for an unnamed one. */
export function getGivenLabel(
  el: MavisElement,
  elementMap: Map<string, MavisElement>,
): string | null {
  if (el.type === 'portal') return (el as PortalElement).label.trim() || null;
  if (el.type === 'text') return (el as TextElement).text.trim() || null;
  return getBoundText(el, elementMap);
}

import type { LinearElement, MavisElement, TextElement } from '@mavisdraw/types';
import { useElementsStore } from '../stores/elementsStore';
import { boundTextBox, getBindingEdgePoint } from '../stores/elementBindings';
import { measureText } from '../utils/fonts';

/**
 * Builders for programmatically created content (diagram-as-code import, AI
 * proposals). They return plain element objects, wired to each other, for the
 * caller to commit in a single store update (one undo step).
 */

export interface ConnectionStyle {
  style?: 'solid' | 'dotted' | 'thick';
  arrowStart?: boolean;
  /** Defaults to true. */
  arrowEnd?: boolean;
}

/** A label bound to a shape (fills it) or a connector (centred on it). */
export function makeLabel(
  diagramId: string,
  container: MavisElement,
  text: string,
  fontSize: number,
): TextElement {
  const store = useElementsStore.getState();
  const base = store.createElement('text', diagramId, 0, 0, 10, 10) as TextElement;
  const isConnector = container.type === 'arrow' || container.type === 'line';
  const size = measureText(text, fontSize, 'hand-drawn', 1.25);
  const box = isConnector
    ? boundTextBox(container, { width: size.width + 10, height: size.height })
    : boundTextBox(container);
  return {
    ...base,
    ...box,
    text,
    fontSize,
    textAlign: 'center',
    verticalAlign: 'middle',
    containerId: container.id,
    zIndex: container.zIndex,
  };
}

export function connectElements(
  diagramId: string,
  from: MavisElement,
  to: MavisElement,
  edge: ConnectionStyle = {},
): LinearElement {
  const store = useElementsStore.getState();
  const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const start = getBindingEdgePoint(from, toCenter.x, toCenter.y, 4);
  const end = getBindingEdgePoint(to, fromCenter.x, fromCenter.y, 4);
  const arrow = store.createElement('arrow', diagramId, start.x, start.y, 1, 1) as LinearElement;
  arrow.points = [
    [0, 0],
    [end.x - start.x, end.y - start.y],
  ];
  arrow.width = Math.abs(end.x - start.x);
  arrow.height = Math.abs(end.y - start.y);
  arrow.startBinding = { elementId: from.id, gap: 4 };
  arrow.endBinding = { elementId: to.id, gap: 4 };
  arrow.startArrowhead = edge.arrowStart ? 'arrow' : 'none';
  arrow.endArrowhead = edge.arrowEnd === false ? 'none' : 'arrow';
  if (edge.style === 'dotted') arrow.strokeStyle = 'dashed';
  if (edge.style === 'thick') arrow.strokeWidth = 3.5;
  from.boundElements = [...from.boundElements, { id: arrow.id, type: 'arrow' }];
  to.boundElements = [...to.boundElements, { id: arrow.id, type: 'arrow' }];
  return arrow;
}

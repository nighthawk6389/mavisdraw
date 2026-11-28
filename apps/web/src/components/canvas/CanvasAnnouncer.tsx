import { useEffect, useState } from 'react';
import { useSelectionStore } from '../../stores/selectionStore';
import { useElementsStore } from '../../stores/elementsStore';
import { useToolStore, type Tool } from '../../stores/toolStore';
import { describeSelection } from './keyboardSelection';

const TOOL_NAMES: Record<Tool, string> = {
  select: 'Select',
  hand: 'Hand',
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
  cylinder: 'Datastore',
  queue: 'Queue',
  line: 'Line',
  arrow: 'Arrow',
  freedraw: 'Draw',
  eraser: 'Eraser',
  text: 'Text',
  portal: 'Nested diagram',
  comment: 'Comment',
};

/**
 * Says what changed on the canvas to screen readers: what's selected, and
 * which tool is on. The canvas itself is a picture; this is its narration.
 */
export default function CanvasAnnouncer() {
  const [message, setMessage] = useState('');

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    // A drag or a shortcut can change things in bursts: say only where it ends up
    const say = (text: string) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setMessage(text), 150);
    };
    const offSelection = useSelectionStore.subscribe((s, prev) => {
      if (s.selectedIds === prev.selectedIds) return;
      say(describeSelection(useElementsStore.getState().elements, s.selectedIds));
    });
    const offTool = useToolStore.subscribe((s, prev) => {
      if (s.activeTool !== prev.activeTool) say(`${TOOL_NAMES[s.activeTool]} tool`);
    });
    return () => {
      offSelection();
      offTool();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid="canvas-announcer">
      {message}
    </div>
  );
}

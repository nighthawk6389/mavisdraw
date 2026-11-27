import { useMemo } from 'react';
import { useVersionStore } from '../../stores/versionStore';
import { useElementsStore } from '../../stores/elementsStore';
import { useDiagramStore } from '../../stores/diagramStore';
import { diffDiagrams, type DiagramDiff } from '../../versions/diff';

/** Live diff between the version being compared and the canvas right now. */
export function useCompareDiff(): DiagramDiff | null {
  const compare = useVersionStore((s) => s.compare);
  const elements = useElementsStore((s) => s.elements);
  const diagramId = useDiagramStore((s) => s.activeDiagramId);
  return useMemo(() => {
    if (!compare || compare.diagramId !== diagramId) return null;
    const now = Array.from(elements.values()).filter((el) => el.diagramId === diagramId);
    return diffDiagrams(compare.elements, now);
  }, [compare, elements, diagramId]);
}

import React, { useRef, useMemo } from 'react';
import Canvas from './components/canvas/Canvas';
import Toolbar from './components/toolbar/Toolbar';
import StylePanel from './components/toolbar/StylePanel';
import LayerPanel from './components/toolbar/LayerPanel';
import Breadcrumb from './components/navigation/Breadcrumb';
import DiagramTreeSidebar from './components/navigation/DiagramTreeSidebar';
import PortalProperties from './components/elements/PortalProperties';
import { useKeyboard } from './hooks/useKeyboard';
import { useSelectionStore } from './stores/selectionStore';
import { useElementsStore } from './stores/elementsStore';

export default function App() {
  const interactionManagerRef = useRef<{ setSpacePressed: (p: boolean) => void } | null>(null);
  useKeyboard(interactionManagerRef);

  // Check if a portal is selected to show portal properties
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const elements = useElementsStore((s) => s.elements);

  const showPortalProperties = useMemo(() => {
    if (selectedIds.size !== 1) return false;
    const id = Array.from(selectedIds)[0];
    const el = elements.get(id);
    return el?.type === 'portal';
  }, [selectedIds, elements]);

  return (
    <div className="flex flex-col h-full w-full bg-white">
      {/* Breadcrumb navigation */}
      <Breadcrumb />

      {/* Main content area */}
      <div className="flex flex-1 min-h-0">
        <Toolbar />
        <DiagramTreeSidebar />

        {/* Canvas area with optional portal properties panel */}
        <div className="flex flex-1 relative">
          <Canvas interactionManagerRef={interactionManagerRef} />

          {/* Portal properties panel overlay */}
          {showPortalProperties && (
            <div className="absolute top-2 right-2 z-30">
              <PortalProperties />
            </div>
          )}
        </div>

        <StylePanel />
        <LayerPanel />
      </div>
    </div>
  );
}

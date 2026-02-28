import React, { useRef } from 'react';
import Canvas from './components/canvas/Canvas';
import Toolbar from './components/toolbar/Toolbar';
import { useKeyboard } from './hooks/useKeyboard';

export default function App() {
  const interactionManagerRef = useRef<{ setSpacePressed: (p: boolean) => void } | null>(null);
  useKeyboard(interactionManagerRef);

  return (
    <div className="flex h-full w-full bg-white">
      <Toolbar />
      <Canvas interactionManagerRef={interactionManagerRef} />
    </div>
  );
}

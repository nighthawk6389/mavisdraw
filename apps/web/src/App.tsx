import React, { useRef, useMemo, useEffect, useState, useCallback, lazy, Suspense } from 'react';
import Canvas from './components/canvas/Canvas';

// Heavy, rarely-open panels load on first use
const ExportDialog = lazy(() => import('./components/export/ExportDialog'));
const AgentPanel = lazy(() => import('./components/agent/AgentPanel'));
const CommandPalette = lazy(() => import('./components/command/CommandPalette'));
const MermaidDialog = lazy(() => import('./components/command/MermaidDialog'));
import Toolbar from './components/toolbar/Toolbar';
import StylePanel from './components/toolbar/StylePanel';
import LayerPanel from './components/toolbar/LayerPanel';
import Breadcrumb from './components/navigation/Breadcrumb';
import DiagramTreeSidebar from './components/navigation/DiagramTreeSidebar';
import PortalProperties from './components/elements/PortalProperties';
import ImportHandler from './components/export/ImportHandler';
import VersionHistoryPanel from './components/version/VersionHistoryPanel';
import GitHubConnectDialog from './components/github/GitHubConnectDialog';
import PresenceAvatars from './components/collaboration/PresenceAvatars';
import ShareDialog from './components/collaboration/ShareDialog';
import { useKeyboard } from './hooks/useKeyboard';
import { useClipboard } from './hooks/useClipboard';
import { installDiagramAsCodePaste } from './import/diagramAsCode';
import Toaster from './components/ui/Toaster';
import { shortcut } from './utils/platform';
import { getCanvasController } from './components/canvas/canvasController';
import { useAutoSnapshot } from './hooks/useAutoSnapshot';
import { useAutoSave, type SaveStatus } from './hooks/useAutoSave';
import { useSelectionStore } from './stores/selectionStore';
import { useElementsStore } from './stores/elementsStore';
import { useAuthStore } from './stores/authStore';
import { useUIStore } from './stores/uiStore';
import { openImportDialog } from './components/export/ImportHandler';
import { useDiagramStore } from './stores/diagramStore';
import LoginPage from './routes/login';
import Dashboard from './routes/dashboard';
import { apiGetDiagram, apiListDiagrams } from './services/api';
import {
  isDiagramLoaded,
  loadDiagramElements,
  markDiagramLoaded,
  resetDiagramSync,
  toDiagram,
} from './services/diagramSync';
import { recordSaved, resetSaveTracking } from './services/saveTracker';
import type { MavisElement, Diagram } from '@mavisdraw/types';

type AppView = 'loading' | 'login' | 'dashboard' | 'editor';

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === 'idle') return null;

  const label =
    status === 'saving' ? 'Saving...' : status === 'saved' ? 'Saved' : 'Save failed';

  const color =
    status === 'saving'
      ? 'text-gray-500'
      : status === 'saved'
        ? 'text-green-600'
        : 'text-red-500';

  return <span className={`text-xs ${color} px-2`}>{label}</span>;
}

function EditorView({ onBackToDashboard }: { onBackToDashboard: () => void }) {
  const interactionManagerRef = useRef<{ setSpacePressed: (p: boolean) => void } | null>(null);
  useKeyboard(interactionManagerRef);
  useClipboard();
  useEffect(() => installDiagramAsCodePaste(), []);
  // Warm the ⌘K palette so the first keystrokes after opening it aren't lost
  useEffect(() => {
    const id = setTimeout(() => void import('./components/command/CommandPalette'), 1500);
    return () => clearTimeout(id);
  }, []);
  useAutoSnapshot();

  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const elements = useElementsStore((s) => s.elements);
  const activeDiagramId = useDiagramStore((s) => s.activeDiagramId);
  const { user, logout } = useAuthStore();

  const { saveStatus, manualSave } = useAutoSave(activeDiagramId);
  const showAgentChat = useUIStore((s) => s.showAgentChat);
  const showExportDialog = useUIStore((s) => s.showExportDialog);
  const showCommandPalette = useUIStore((s) => s.showCommandPalette);
  const showMermaidDialog = useUIStore((s) => s.showMermaidDialog);
  const [showShareDialog, setShowShareDialog] = useState(false);

  const diagrams = useDiagramStore((s) => s.diagrams);
  const projectId = diagrams.get(activeDiagramId)?.projectId ?? null;

  // Nested diagrams load their contents the first time they're opened
  useEffect(() => {
    if (!activeDiagramId) return;
    const firstVisit = !isDiagramLoaded(activeDiagramId);
    loadDiagramElements(activeDiagramId)
      .then(() => {
        // First time here: frame the content once it has arrived
        const store = useDiagramStore.getState();
        if (firstVisit && store.activeDiagramId === activeDiagramId && !store.getViewport(activeDiagramId)) {
          getCanvasController()?.zoomToFit();
        }
      })
      .catch((err) => console.error('Failed to load diagram:', err));
  }, [activeDiagramId]);

  // Contextual panels follow the settled selection (see selectionStore)
  const settledSelectedIds = useSelectionStore((s) => s.settledSelectedIds);
  const showPortalProperties = useMemo(() => {
    if (settledSelectedIds.size !== 1 || selectedIds.size !== 1) return false;
    const id = Array.from(selectedIds)[0];
    if (!settledSelectedIds.has(id)) return false;
    return elements.get(id)?.type === 'portal';
  }, [selectedIds, settledSelectedIds, elements]);

  return (
    <div className="flex flex-col h-full w-full bg-white">
      {/* Top bar with breadcrumb, save status, and user info */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white">
        <div className="flex items-center">
          <button
            onClick={onBackToDashboard}
            className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 border-r border-gray-200"
            title="Back to dashboard"
          >
            &larr; Projects
          </button>
          <Breadcrumb />
          <SaveIndicator status={saveStatus} />
        </div>
        <div className="flex items-center gap-3 pr-3">
          <PresenceAvatars />
          <button
            onClick={() => useUIStore.getState().setShowCommandPalette(true)}
            className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-700 px-2 py-1 border border-gray-300 rounded"
            title="Jump to any shape or diagram, or run a command"
            aria-label="Search"
          >
            Search
            <kbd className="rounded bg-gray-100 px-1 text-[10px] text-gray-500">{shortcut('Mod+K')}</kbd>
          </button>
          <button
            onClick={openImportDialog}
            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 border border-gray-300 rounded"
            title="Import file"
          >
            Import
          </button>
          <button
            onClick={() => useUIStore.getState().toggleExportDialog()}
            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 border border-gray-300 rounded"
            title="Export diagram"
          >
            Export
          </button>
          <button
            onClick={() => useUIStore.getState().toggleVersionHistory()}
            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 border border-gray-300 rounded"
            title="Version history"
          >
            History
          </button>
          <button
            onClick={() => useUIStore.getState().toggleGitHubDialog()}
            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 border border-gray-300 rounded"
            title="GitHub connections"
          >
            GitHub
          </button>
          <button
            onClick={() => useUIStore.getState().toggleAgentChat()}
            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 border border-gray-300 rounded"
            title="AI Chat"
          >
            AI Chat
          </button>
          <div className="w-px h-4 bg-gray-300" />
          <button
            onClick={() => setShowShareDialog(true)}
            className="text-xs text-white bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded"
          >
            Share
          </button>
          <button
            onClick={manualSave}
            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 border border-gray-300 rounded"
          >
            Save
          </button>
          <span className="text-xs text-gray-500">{user?.name}</span>
          <button onClick={logout} className="text-xs text-gray-400 hover:text-gray-600">
            Sign out
          </button>
        </div>
      </div>

      {/* Share dialog */}
      {projectId && (
        <ShareDialog
          projectId={projectId}
          isOpen={showShareDialog}
          onClose={() => setShowShareDialog(false)}
        />
      )}

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
        <VersionHistoryPanel />
        {showAgentChat && (
          <Suspense fallback={null}>
            <AgentPanel />
          </Suspense>
        )}
      </div>

      {/* Overlays */}
      <Toaster />
      {showCommandPalette && (
        <Suspense fallback={null}>
          <CommandPalette onClose={() => useUIStore.getState().setShowCommandPalette(false)} />
        </Suspense>
      )}
      {showMermaidDialog && (
        <Suspense fallback={null}>
          <MermaidDialog onClose={() => useUIStore.getState().setShowMermaidDialog(false)} />
        </Suspense>
      )}
      {showExportDialog && (
        <Suspense fallback={null}>
          <ExportDialog />
        </Suspense>
      )}
      <ImportHandler />
      <GitHubConnectDialog />
    </div>
  );
}

export default function App() {
  const { isAuthenticated, isLoading, initialize } = useAuthStore();
  const [userView, setUserView] = useState<'dashboard' | 'editor'>('dashboard');

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Determine active view based on auth state and user selection
  const view: AppView = isLoading
    ? 'loading'
    : !isAuthenticated
      ? 'login'
      : userView;

  const handleOpenProject = useCallback(
    async (projectId: string, rootDiagramId: string) => {
      try {
        // Load the whole hierarchy (titles/structure); elements load per diagram on open
        const response = await apiListDiagrams(projectId);
        const newDiagrams = new Map<string, Diagram>();
        for (const d of response.diagrams) {
          const diagram = toDiagram(d);
          newDiagrams.set(diagram.id, diagram);
        }

        resetDiagramSync(newDiagrams.keys());
        resetSaveTracking();

        // Load root diagram elements
        const rootResponse = await apiGetDiagram(rootDiagramId);
        const elements = rootResponse.diagram.elements as MavisElement[];
        useElementsStore.getState().setElements(elements);
        markDiagramLoaded(rootDiagramId);
        recordSaved(rootDiagramId, elements, newDiagrams.get(rootDiagramId)?.updatedAt);

        // Replace all diagrams with only this project's diagrams
        useDiagramStore.setState({
          diagrams: newDiagrams,
          activeDiagramId: rootDiagramId,
          diagramPath: [rootDiagramId],
        });

        setUserView('editor');
      } catch (err) {
        console.error('Failed to open project:', err);
      }
    },
    [],
  );

  const handleBackToDashboard = useCallback(() => {
    setUserView('dashboard');
  }, []);

  if (view === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (view === 'login') {
    return <LoginPage />;
  }

  if (view === 'dashboard') {
    return <Dashboard onOpenProject={handleOpenProject} />;
  }

  return <EditorView onBackToDashboard={handleBackToDashboard} />;
}

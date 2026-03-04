import React, { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import Canvas from './components/canvas/Canvas';
import Toolbar from './components/toolbar/Toolbar';
import StylePanel from './components/toolbar/StylePanel';
import LayerPanel from './components/toolbar/LayerPanel';
import Breadcrumb from './components/navigation/Breadcrumb';
import DiagramTreeSidebar from './components/navigation/DiagramTreeSidebar';
import PortalProperties from './components/elements/PortalProperties';
import ExportDialog from './components/export/ExportDialog';
import ImportHandler from './components/export/ImportHandler';
import VersionHistoryPanel from './components/version/VersionHistoryPanel';
import PresenceAvatars from './components/collaboration/PresenceAvatars';
import ShareDialog from './components/collaboration/ShareDialog';
import { useKeyboard } from './hooks/useKeyboard';
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
  useAutoSnapshot();

  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const elements = useElementsStore((s) => s.elements);
  const activeDiagramId = useDiagramStore((s) => s.activeDiagramId);
  const { user, logout } = useAuthStore();

  const { saveStatus, manualSave } = useAutoSave(activeDiagramId);
  const [showShareDialog, setShowShareDialog] = useState(false);

  const diagrams = useDiagramStore((s) => s.diagrams);
  const projectId = diagrams.get(activeDiagramId)?.projectId ?? null;

  const showPortalProperties = useMemo(() => {
    if (selectedIds.size !== 1) return false;
    const id = Array.from(selectedIds)[0];
    const el = elements.get(id);
    return el?.type === 'portal';
  }, [selectedIds, elements]);

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
      </div>

      {/* Overlays */}
      <ExportDialog />
      <ImportHandler />
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
        // Load all diagrams for the project
        const response = await apiListDiagrams(projectId);

        const newDiagrams = new Map<string, Diagram>();
        for (const d of response.diagrams) {
          const diagram: Diagram = {
            id: d.id,
            projectId: d.projectId,
            parentDiagramId: d.parentDiagramId,
            parentPortalId: d.parentPortalId,
            title: d.title,
            viewBackgroundColor: d.viewBackgroundColor,
            gridEnabled: d.gridEnabled,
            gridSize: d.gridSize,
            renderMode: d.renderMode as 'sketchy' | 'clean',
            layers: d.layers as Diagram['layers'],
            createdBy: d.createdBy,
            createdAt: new Date(d.createdAt).getTime(),
            updatedAt: new Date(d.updatedAt).getTime(),
          };
          newDiagrams.set(diagram.id, diagram);
        }

        // Load root diagram elements
        const rootResponse = await apiGetDiagram(rootDiagramId);
        const elementsStore = useElementsStore.getState();
        const elements = rootResponse.diagram.elements as MavisElement[];
        elementsStore.setElements(elements);

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

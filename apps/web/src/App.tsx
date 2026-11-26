import React, { useRef, useMemo, useEffect, useState, useCallback, lazy, Suspense } from 'react';
import Canvas from './components/canvas/Canvas';

// Heavy, rarely-open panels load on first use
const ExportDialog = lazy(() => import('./components/export/ExportDialog'));
const AgentPanel = lazy(() => import('./components/agent/AgentPanel'));
const VersionHistoryPanel = lazy(() => import('./components/version/VersionHistoryPanel'));
const CommandPalette = lazy(() => import('./components/command/CommandPalette'));
const MermaidDialog = lazy(() => import('./components/command/MermaidDialog'));
import Toolbar from './components/toolbar/Toolbar';
import StylePanel from './components/toolbar/StylePanel';
import LayerPanel from './components/toolbar/LayerPanel';
import Breadcrumb from './components/navigation/Breadcrumb';
import DiagramTreeSidebar from './components/navigation/DiagramTreeSidebar';
import PortalProperties from './components/elements/PortalProperties';
import ImportHandler from './components/export/ImportHandler';
import CommentsPanel from './components/comments/CommentsPanel';
import NotificationBell from './components/comments/NotificationBell';
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
import { apiGetDiagram, apiGetProject, apiJoinViaShareLink, apiListDiagrams } from './services/api';
import { navigate, projectPath, reflectPath, useRoute } from './routing';
import { useCommentsStore } from './stores/commentsStore';
import { usePermissionStore, type ProjectRole } from './stores/permissionStore';
import { toast } from './stores/toastStore';
import {
  isDiagramLoaded,
  loadDiagramElements,
  markDiagramLoaded,
  resetDiagramSync,
  toDiagram,
} from './services/diagramSync';
import { recordSaved, resetSaveTracking } from './services/saveTracker';
import type { MavisElement, Diagram } from '@mavisdraw/types';


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
  const rootDiagramId = useDiagramStore((s) => s.diagramPath[0]);
  const canEditProject = usePermissionStore((s) => s.canEdit);
  const role = usePermissionStore((s) => s.role);
  const showVersionHistory = useUIStore((s) => s.showVersionHistory);
  const canShare = role === 'owner' || role === 'admin';

  // The address bar always points at what's on screen (shareable deep link).
  // Drilling in or out adds a history entry, so the browser's Back button
  // goes back up a level instead of leaving the project.
  const reflectedRef = useRef(false);
  useEffect(() => {
    if (!projectId) return;
    const path = projectPath(projectId, activeDiagramId === rootDiagramId ? null : activeDiagramId);
    reflectPath(path, { push: reflectedRef.current });
    reflectedRef.current = true;
  }, [projectId, activeDiagramId, rootDiagramId]);

  // Back/Forward: show the diagram the address names
  const route = useRoute();
  useEffect(() => {
    if (route.name !== 'project' || route.projectId !== projectId) return;
    const target = route.diagramId ?? rootDiagramId;
    const store = useDiagramStore.getState();
    if (target && target !== store.activeDiagramId && store.diagrams.has(target)) {
      store.navigateToDiagram(target);
    }
  }, [route, projectId, rootDiagramId]);

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
          {!canEditProject && (
            <span
              className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
              title="You have view access to this project"
              data-testid="view-only-badge"
            >
              View only
            </span>
          )}
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
          {canEditProject && (
            <button
              onClick={openImportDialog}
              className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 border border-gray-300 rounded"
              title="Import file"
            >
              Import
            </button>
          )}
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
          <CommentsButton />
          {canEditProject && (
            <>
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
            </>
          )}
          <div className="w-px h-4 bg-gray-300" />
          {canShare && (
            <button
              onClick={() => setShowShareDialog(true)}
              className="text-xs text-white bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded"
            >
              Share
            </button>
          )}
          {canEditProject && (
            <button
              onClick={manualSave}
              className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 border border-gray-300 rounded"
            >
              Save
            </button>
          )}
          <NotificationBell />
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

        {canEditProject && <StylePanel />}
        {canEditProject && <LayerPanel />}
        {showVersionHistory && (
          <Suspense fallback={null}>
            <VersionHistoryPanel />
          </Suspense>
        )}
        <CommentsPanel />
        {showAgentChat && canEditProject && (
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

/** Load a project into the editor stores; optionally open a nested diagram. */
/** Header toggle for the comments panel, with the number of open threads. */
function CommentsButton() {
  const threads = useCommentsStore((s) => s.threads);
  const panelOpen = useCommentsStore((s) => s.panelOpen);
  const open = useMemo(
    () => Array.from(threads.values()).filter((t) => !t.resolvedAt).length,
    [threads],
  );
  return (
    <button
      onClick={() => useCommentsStore.getState().setPanelOpen(!panelOpen)}
      className={`text-xs px-2 py-1 border rounded ${
        panelOpen
          ? 'border-blue-300 bg-blue-50 text-blue-700'
          : 'border-gray-300 text-gray-500 hover:text-gray-700'
      }`}
      title="Comments (C to add one)"
      aria-pressed={panelOpen}
    >
      Comments{open > 0 ? ` · ${open}` : ''}
    </button>
  );
}

async function loadProject(projectId: string, diagramId: string | null): Promise<void> {
  const { project } = await apiGetProject(projectId);
  if (!project.rootDiagramId) throw new Error('Project has no root diagram');
  usePermissionStore.getState().setRole((project.role as ProjectRole | undefined) ?? 'viewer');

  // The whole hierarchy (titles/structure); elements load per diagram on open
  const response = await apiListDiagrams(projectId);
  const newDiagrams = new Map<string, Diagram>();
  for (const d of response.diagrams) {
    const diagram = toDiagram(d);
    newDiagrams.set(diagram.id, diagram);
  }

  resetDiagramSync(newDiagrams.keys());
  resetSaveTracking();

  const rootId = project.rootDiagramId;
  const rootResponse = await apiGetDiagram(rootId);
  const elements = rootResponse.diagram.elements as MavisElement[];
  useElementsStore.getState().setElements(elements);
  markDiagramLoaded(rootId);
  recordSaved(rootId, elements, newDiagrams.get(rootId)?.updatedAt);

  useDiagramStore.setState({
    diagrams: newDiagrams,
    activeDiagramId: rootId,
    diagramPath: [rootId],
    viewportCache: new Map(),
  });
  // Deep link into a nested diagram
  if (diagramId && diagramId !== rootId && newDiagrams.has(diagramId)) {
    useDiagramStore.getState().navigateToDiagram(diagramId);
  }

  // Comments for every level; ?thread=… (from a notification or a copied
  // link) opens that thread once the canvas is up
  const threadId = new URLSearchParams(window.location.search).get('thread');
  useCommentsStore.setState({ pendingThreadId: threadId });
  void useCommentsStore.getState().load(projectId);
}

export default function App() {
  const { isAuthenticated, isLoading, initialize } = useAuthStore();
  const route = useRoute();
  const [openedProjectId, setOpenedProjectId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    initialize();
  }, [initialize]);

  // /share/:token → join the project, then open it
  useEffect(() => {
    if (!isAuthenticated || route.name !== 'share') return;
    let cancelled = false;
    apiJoinViaShareLink(route.token)
      .then(({ projectId, role }) => {
        if (cancelled) return;
        toast(`You now have ${role === 'viewer' ? 'view' : 'edit'} access`, 'success');
        navigate(projectPath(projectId), { replace: true });
      })
      .catch((err) => {
        if (cancelled) return;
        toast(`This share link doesn't work: ${err instanceof Error ? err.message : err}`, 'error');
        navigate('/', { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, route]);

  // /p/:projectId[/d/:diagramId] → load the project once
  const routeProjectId = route.name === 'project' ? route.projectId : null;
  const routeDiagramId = route.name === 'project' ? route.diagramId : null;
  useEffect(() => {
    if (!isAuthenticated || !routeProjectId || routeProjectId === openedProjectId) return;
    let cancelled = false;
    loadProject(routeProjectId, routeDiagramId)
      .then(() => {
        if (!cancelled) {
          setOpenError(null);
          setOpenedProjectId(routeProjectId);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to open project:', err);
        setOpenError(err instanceof Error ? err.message : 'Failed to open project');
        toast("Couldn't open that project", 'error');
        navigate('/', { replace: true });
      });
    return () => {
      cancelled = true;
    };
    // Only the project id triggers a (re)load; diagram changes are handled in the editor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, routeProjectId, openedProjectId]);

  const handleOpenProject = useCallback((projectId: string) => {
    navigate(projectPath(projectId));
  }, []);

  const handleBackToDashboard = useCallback(() => {
    setOpenedProjectId(null);
    navigate('/');
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage sharedLink={route.name === 'share'} />;
  }

  if (route.name === 'project' && openedProjectId === route.projectId) {
    return <EditorView onBackToDashboard={handleBackToDashboard} />;
  }

  if (route.name === 'project' || route.name === 'share') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">{openError ?? 'Opening…'}</div>
        <Toaster />
      </div>
    );
  }

  return (
    <>
      <Dashboard onOpenProject={handleOpenProject} />
      <Toaster />
    </>
  );
}

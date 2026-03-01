import { useEffect, useCallback, useRef } from 'react';
import { useCollaborationStore } from '../stores/collaborationStore';
import { useAuthStore } from '../stores/authStore';
import { useSelectionStore } from '../stores/selectionStore';
import type { Viewport } from '@mavisdraw/types';

export function useCollaboration(diagramId: string | null) {
  const { user, isAuthenticated } = useAuthStore();
  const {
    connect,
    disconnect,
    updateSelection,
    updateViewport,
    connectionStatus,
    currentDiagramId,
    followingUserId,
    connectedUsers,
  } = useCollaborationStore();
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const prevDiagramId = useRef<string | null>(null);

  // Connect when diagram changes (handles both initial connect and room switching)
  useEffect(() => {
    if (!diagramId || !isAuthenticated || !user) return;

    // Skip if already connected to this diagram
    if (diagramId === currentDiagramId) return;

    connect(diagramId, user.id, user.name);
    prevDiagramId.current = diagramId;

    return () => {
      // Only disconnect if the component is truly unmounting,
      // not just switching diagrams (room switching handled by connect)
    };
  }, [diagramId, isAuthenticated, user?.id]);

  // Disconnect on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  // Sync selection to awareness
  useEffect(() => {
    if (connectionStatus !== 'connected') return;
    updateSelection(Array.from(selectedIds));
  }, [selectedIds, connectionStatus, updateSelection]);

  // Follow user viewport
  useEffect(() => {
    if (!followingUserId) return;

    const followedUser = connectedUsers.find((u) => u.id === followingUserId);
    if (!followedUser?.viewport) return;

    // Return the viewport for the caller to apply
  }, [followingUserId, connectedUsers]);

  const handleMouseMove = useCallback((x: number, y: number) => {
    const store = useCollaborationStore.getState();
    store.updateCursor(x, y);
  }, []);

  const handleViewportChange = useCallback((viewport: Viewport) => {
    updateViewport(viewport);
  }, [updateViewport]);

  // Get the followed user's viewport for the caller to apply
  const getFollowedViewport = useCallback((): Viewport | null => {
    const state = useCollaborationStore.getState();
    if (!state.followingUserId) return null;
    const followed = state.connectedUsers.find((u) => u.id === state.followingUserId);
    return followed?.viewport ?? null;
  }, []);

  return {
    handleMouseMove,
    handleViewportChange,
    getFollowedViewport,
    isConnected: connectionStatus === 'connected',
    connectionStatus,
  };
}

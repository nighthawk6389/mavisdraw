import { useEffect, useCallback, useMemo } from 'react';
import { useCollaborationStore } from '../stores/collaborationStore';
import { useAuthStore } from '../stores/authStore';
import { useSelectionStore } from '../stores/selectionStore';
import type { Viewport } from '@mavisdraw/types';

export function useCollaboration(diagramId: string | null) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const connectionStatus = useCollaborationStore((s) => s.connectionStatus);
  const currentDiagramId = useCollaborationStore((s) => s.currentDiagramId);
  const followingUserId = useCollaborationStore((s) => s.followingUserId);
  const connectedUsers = useCollaborationStore((s) => s.connectedUsers);
  const selectedIds = useSelectionStore((s) => s.selectedIds);

  // Connect when diagram changes (handles both initial connect and room switching)
  useEffect(() => {
    if (!diagramId || !isAuthenticated || !user) return;

    // Skip if already connected to this diagram
    if (diagramId === currentDiagramId) return;

    useCollaborationStore.getState().connect(diagramId, user.id, user.name);
  }, [diagramId, isAuthenticated, user, currentDiagramId]);

  // Disconnect on unmount
  useEffect(() => {
    return () => {
      useCollaborationStore.getState().disconnect();
    };
  }, []);

  // Sync selection to awareness
  useEffect(() => {
    if (connectionStatus !== 'connected') return;
    useCollaborationStore.getState().updateSelection(Array.from(selectedIds));
  }, [selectedIds, connectionStatus]);

  // Derive followed user's viewport during render (not in an effect)
  const followedViewport = useMemo((): Viewport | null => {
    if (!followingUserId) return null;
    const followed = connectedUsers.find((u) => u.id === followingUserId);
    return followed?.viewport ?? null;
  }, [followingUserId, connectedUsers]);

  const handleMouseMove = useCallback((x: number, y: number) => {
    useCollaborationStore.getState().updateCursor(x, y);
  }, []);

  const handleViewportChange = useCallback((viewport: Viewport) => {
    useCollaborationStore.getState().updateViewport(viewport);
  }, []);

  return {
    handleMouseMove,
    handleViewportChange,
    followedViewport,
    isConnected: connectionStatus === 'connected',
    connectionStatus,
  };
}

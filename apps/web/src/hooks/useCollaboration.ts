import { useEffect, useCallback } from 'react';
import { useCollaborationStore } from '../stores/collaborationStore';
import { useAuthStore } from '../stores/authStore';
import { useSelectionStore } from '../stores/selectionStore';

export function useCollaboration(diagramId: string | null) {
  const { user, isAuthenticated } = useAuthStore();
  const { connect, disconnect, updateSelection, isConnected } = useCollaborationStore();
  const selectedIds = useSelectionStore((s) => s.selectedIds);

  // Connect when diagram changes
  useEffect(() => {
    if (!diagramId || !isAuthenticated || !user) return;

    connect(diagramId, user.id, user.name);

    return () => {
      disconnect();
    };
  }, [diagramId, isAuthenticated, user?.id]);

  // Sync selection to awareness
  useEffect(() => {
    if (!isConnected) return;
    updateSelection(Array.from(selectedIds));
  }, [selectedIds, isConnected, updateSelection]);

  const handleMouseMove = useCallback(
    (x: number, y: number) => {
      const store = useCollaborationStore.getState();
      store.updateCursor(x, y);
    },
    [],
  );

  return { handleMouseMove, isConnected };
}

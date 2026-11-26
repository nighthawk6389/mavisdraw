import React, { useState, useCallback, useEffect } from 'react';
import { useUIStore } from '../../stores/uiStore';
import { useVersionStore } from '../../stores/versionStore';
import { useDiagramStore } from '../../stores/diagramStore';
import { usePermissionStore } from '../../stores/permissionStore';

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHrs < 24) return `${diffHrs}h ago`;

  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function VersionHistoryPanel() {
  const showVersionHistory = useUIStore((s) => s.showVersionHistory);
  const toggleVersionHistory = useUIStore((s) => s.toggleVersionHistory);
  const snapshots = useVersionStore((s) => s.snapshots);
  const saveSnapshot = useVersionStore((s) => s.saveSnapshot);
  const restoreSnapshot = useVersionStore((s) => s.restoreSnapshot);
  const isLoading = useVersionStore((s) => s.isLoading);
  const activeDiagramId = useDiagramStore((s) => s.activeDiagramId);
  const canEditProject = usePermissionStore((s) => s.canEdit);

  const [newLabel, setNewLabel] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Versions of the diagram on screen (shared with everyone on the project)
  useEffect(() => {
    if (showVersionHistory) {
      void useVersionStore.getState().load(activeDiagramId);
    }
  }, [showVersionHistory, activeDiagramId]);

  const handleSave = useCallback(async () => {
    if (!newLabel.trim()) return;
    setIsSaving(true);
    try {
      await saveSnapshot(newLabel.trim());
      setNewLabel('');
    } finally {
      setIsSaving(false);
    }
  }, [newLabel, saveSnapshot]);

  const handleRestore = useCallback(
    async (snapshotId: string) => {
      if (!confirm('Restore this version? Current state will be saved as a backup.')) return;
      await restoreSnapshot(snapshotId);
    },
    [restoreSnapshot],
  );

  if (!showVersionHistory) return null;

  return (
    <div
      className="w-64 border-l bg-white flex flex-col overflow-hidden"
      data-testid="version-history"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
          Version History
        </h3>
        <button
          onClick={toggleVersionHistory}
          className="text-gray-400 hover:text-gray-600 text-sm"
        >
          &times;
        </button>
      </div>

      {/* Save new version */}
      {canEditProject && (
        <div className="px-3 py-2 border-b bg-gray-50">
          <div className="flex gap-1">
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
              }}
              placeholder="Version label..."
              className="flex-1 text-xs border rounded px-2 py-1 bg-white"
            />
            <button
              onClick={handleSave}
              disabled={isSaving || !newLabel.trim()}
              className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {/* Snapshot list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && <div className="px-3 py-4 text-xs text-gray-400 text-center">Loading...</div>}

        {!isLoading && snapshots.length === 0 && (
          <div className="px-3 py-4 text-xs text-gray-400 text-center">No versions saved yet.</div>
        )}

        {snapshots.map((snapshot) => (
          <div
            key={snapshot.id}
            data-testid="version-entry"
            className="px-3 py-2 border-b hover:bg-gray-50 group"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-gray-800 truncate">
                  {snapshot.label || `Version ${snapshot.version}`}
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-1">
                  <span>{formatDate(new Date(snapshot.createdAt).getTime())}</span>
                  {snapshot.trigger === 'auto' && (
                    <span className="bg-gray-200 text-gray-500 px-1 rounded text-[9px]">auto</span>
                  )}
                </div>
                <div className="text-[10px] text-gray-400">{snapshot.elementCount} elements</div>
              </div>

              {canEditProject && (
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity ml-2">
                  <button
                    onClick={() => handleRestore(snapshot.id)}
                    className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100"
                    title="Restore this version (for everyone)"
                  >
                    Restore
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

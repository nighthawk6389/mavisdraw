import React, { useState, useCallback, useMemo } from 'react';
import { useDiagramStore, buildTreeForParent } from '../../stores/diagramStore';
import type { DiagramTreeNode } from '../../stores/diagramStore';
import { useUIStore } from '../../stores/uiStore';
import { useElementsStore } from '../../stores/elementsStore';

interface TreeNodeProps {
  node: DiagramTreeNode;
  activeDiagramId: string;
  depth: number;
  onNavigate: (diagramId: string) => void;
  onRename: (diagramId: string, newTitle: string) => void;
  onDelete: (diagramId: string) => void;
  onCreateChild: (parentId: string) => void;
  getElementCount: (diagramId: string) => number;
}

function TreeNode({
  node,
  activeDiagramId,
  depth,
  onNavigate,
  onRename,
  onDelete,
  onCreateChild,
  getElementCount,
}: TreeNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(node.diagram.title);
  const [showContextMenu, setShowContextMenu] = useState(false);

  const isActive = node.diagram.id === activeDiagramId;
  const hasChildren = node.children.length > 0;
  const elementCount = getElementCount(node.diagram.id);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setShowContextMenu(true);
  }, []);

  const handleRenameSubmit = useCallback(() => {
    if (editTitle.trim()) {
      onRename(node.diagram.id, editTitle.trim());
    }
    setIsEditing(false);
  }, [editTitle, node.diagram.id, onRename]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleRenameSubmit();
      } else if (e.key === 'Escape') {
        setEditTitle(node.diagram.title);
        setIsEditing(false);
      }
    },
    [handleRenameSubmit, node.diagram.title],
  );

  // Close context menu on outside click
  React.useEffect(() => {
    if (!showContextMenu) return;
    const handler = () => setShowContextMenu(false);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [showContextMenu]);

  return (
    <div>
      <div
        className={`flex items-center h-7 px-1 cursor-pointer rounded group relative
          ${isActive ? 'bg-blue-100 text-blue-800' : 'hover:bg-gray-100 text-gray-700'}
        `}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        onClick={() => onNavigate(node.diagram.id)}
        onContextMenu={handleContextMenu}
        data-testid={`tree-node-${node.diagram.id}`}
      >
        {/* Expand/collapse toggle */}
        <button
          className={`w-4 h-4 flex items-center justify-center text-xs mr-1 flex-shrink-0
            ${hasChildren ? 'text-gray-500' : 'text-transparent'}`}
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) setExpanded(!expanded);
          }}
        >
          {hasChildren ? (expanded ? '\u25BE' : '\u25B8') : '\u00B7'}
        </button>

        {/* Title or edit input */}
        {isEditing ? (
          <input
            className="flex-1 text-xs bg-white border border-blue-300 rounded px-1 py-0
              outline-none min-w-0"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            autoFocus
          />
        ) : (
          <span
            className={`flex-1 text-xs truncate ${isActive ? 'font-semibold' : ''}`}
            title={node.diagram.title}
          >
            {node.diagram.title}
          </span>
        )}

        {/* Element count */}
        <span className="text-[10px] text-gray-400 ml-1 flex-shrink-0">
          {elementCount}
        </span>

        {/* Context menu */}
        {showContextMenu && (
          <div
            className="absolute right-0 top-full mt-1 bg-white shadow-lg rounded-md border
              border-gray-200 py-1 z-50 min-w-[120px]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="w-full text-left px-3 py-1 text-xs hover:bg-gray-100"
              onClick={() => {
                setIsEditing(true);
                setShowContextMenu(false);
              }}
            >
              Rename
            </button>
            <button
              className="w-full text-left px-3 py-1 text-xs hover:bg-gray-100"
              onClick={() => {
                onCreateChild(node.diagram.id);
                setShowContextMenu(false);
              }}
            >
              Create child
            </button>
            {node.diagram.parentDiagramId !== null && (
              <button
                className="w-full text-left px-3 py-1 text-xs text-red-600 hover:bg-red-50"
                onClick={() => {
                  onDelete(node.diagram.id);
                  setShowContextMenu(false);
                }}
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.diagram.id}
              node={child}
              activeDiagramId={activeDiagramId}
              depth={depth + 1}
              onNavigate={onNavigate}
              onRename={onRename}
              onDelete={onDelete}
              onCreateChild={onCreateChild}
              getElementCount={getElementCount}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DiagramTreeSidebar() {
  const showDiagramTree = useUIStore((s) => s.showDiagramTree);
  const toggleDiagramTree = useUIStore((s) => s.toggleDiagramTree);
  const diagrams = useDiagramStore((s) => s.diagrams);
  const activeDiagramId = useDiagramStore((s) => s.activeDiagramId);
  const navigateToDiagram = useDiagramStore((s) => s.navigateToDiagram);
  const updateDiagram = useDiagramStore((s) => s.updateDiagram);
  const deleteDiagram = useDiagramStore((s) => s.deleteDiagram);
  const createDiagram = useDiagramStore((s) => s.createDiagram);
  const elements = useElementsStore((s) => s.elements);

  const tree = useMemo(() => buildTreeForParent(diagrams, null), [diagrams]);

  const getElementCount = useCallback(
    (diagramId: string) => {
      let count = 0;
      for (const el of elements.values()) {
        if (el.diagramId === diagramId && !el.isDeleted) {
          count++;
        }
      }
      return count;
    },
    [elements],
  );

  const handleRename = useCallback(
    (diagramId: string, newTitle: string) => {
      updateDiagram(diagramId, { title: newTitle });
    },
    [updateDiagram],
  );

  const handleDelete = useCallback(
    (diagramId: string) => {
      deleteDiagram(diagramId);
    },
    [deleteDiagram],
  );

  const handleCreateChild = useCallback(
    (parentId: string) => {
      createDiagram(parentId, null, 'New Diagram');
    },
    [createDiagram],
  );

  if (!showDiagramTree) return null;

  return (
    <aside
      className="w-52 bg-white border-r border-gray-200 flex flex-col z-10 select-none"
      data-testid="diagram-tree-sidebar"
    >
      {/* Header */}
      <div className="flex items-center justify-between h-8 px-2 border-b border-gray-100">
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
          Diagrams
        </span>
        <button
          className="w-5 h-5 flex items-center justify-center text-gray-400
            hover:text-gray-600 text-xs"
          onClick={toggleDiagramTree}
          title="Close diagram tree"
        >
          ×
        </button>
      </div>

      {/* Tree content */}
      <div className="flex-1 overflow-y-auto py-1">
        {tree.map((node) => (
          <TreeNode
            key={node.diagram.id}
            node={node}
            activeDiagramId={activeDiagramId}
            depth={0}
            onNavigate={navigateToDiagram}
            onRename={handleRename}
            onDelete={handleDelete}
            onCreateChild={handleCreateChild}
            getElementCount={getElementCount}
          />
        ))}
      </div>
    </aside>
  );
}

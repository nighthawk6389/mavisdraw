import React from 'react';
import { useCollaborationStore } from '../../stores/collaborationStore';

export default function CursorOverlay() {
  const remoteCursors = useCollaborationStore((s) => s.remoteCursors);

  if (remoteCursors.size === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none z-50 overflow-hidden">
      {Array.from(remoteCursors.values()).map((cursor) => (
        <div
          key={cursor.userId}
          className="absolute transition-all duration-100 ease-out"
          style={{
            left: cursor.x,
            top: cursor.y,
            transform: 'translate(-2px, -2px)',
          }}
        >
          {/* Cursor arrow */}
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }}
          >
            <path
              d="M4 1L4 16L8.5 11.5L14 16L4 1Z"
              fill={cursor.userColor}
              stroke="white"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>

          {/* Name label */}
          <div
            className="absolute left-4 top-4 px-1.5 py-0.5 rounded text-xs text-white whitespace-nowrap"
            style={{
              backgroundColor: cursor.userColor,
              fontSize: '10px',
              lineHeight: '14px',
            }}
          >
            {cursor.userName}
          </div>
        </div>
      ))}
    </div>
  );
}

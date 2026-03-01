import React from 'react';
import { useCollaborationStore } from '../../stores/collaborationStore';

export default function PresenceAvatars() {
  const connectedUsers = useCollaborationStore((s) => s.connectedUsers);
  const isConnected = useCollaborationStore((s) => s.isConnected);

  if (!isConnected && connectedUsers.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      {/* Connection indicator */}
      <div
        className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-400'}`}
        title={isConnected ? 'Connected' : 'Disconnected'}
      />

      {/* User avatars */}
      <div className="flex -space-x-2">
        {connectedUsers.slice(0, 5).map((user) => (
          <div
            key={user.id}
            className="w-7 h-7 rounded-full border-2 border-white flex items-center justify-center text-xs text-white font-medium"
            style={{ backgroundColor: user.color }}
            title={user.name}
          >
            {user.name.charAt(0).toUpperCase()}
          </div>
        ))}
        {connectedUsers.length > 5 && (
          <div className="w-7 h-7 rounded-full border-2 border-white bg-gray-400 flex items-center justify-center text-xs text-white font-medium">
            +{connectedUsers.length - 5}
          </div>
        )}
      </div>

      {connectedUsers.length > 0 && (
        <span className="text-xs text-gray-500 ml-1">
          {connectedUsers.length} online
        </span>
      )}
    </div>
  );
}

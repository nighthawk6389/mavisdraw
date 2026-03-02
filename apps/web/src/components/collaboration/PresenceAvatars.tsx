import React from 'react';
import { useCollaborationStore } from '../../stores/collaborationStore';

export default function PresenceAvatars() {
  const connectedUsers = useCollaborationStore((s) => s.connectedUsers);
  const connectionStatus = useCollaborationStore((s) => s.connectionStatus);
  const followingUserId = useCollaborationStore((s) => s.followingUserId);
  const followUser = useCollaborationStore((s) => s.followUser);

  const showIndicator = connectionStatus !== 'disconnected' || connectedUsers.length > 0;
  if (!showIndicator) return null;

  const statusColor =
    connectionStatus === 'connected'
      ? 'bg-green-500'
      : connectionStatus === 'connecting' || connectionStatus === 'syncing'
        ? 'bg-yellow-500 animate-pulse'
        : 'bg-gray-400';

  const statusText =
    connectionStatus === 'connected'
      ? 'Connected'
      : connectionStatus === 'connecting'
        ? 'Connecting...'
        : connectionStatus === 'syncing'
          ? 'Syncing...'
          : 'Offline';

  const handleAvatarClick = (userId: string) => {
    // Toggle follow: click to follow, click again to unfollow
    if (followingUserId === userId) {
      followUser(null);
    } else {
      followUser(userId);
    }
  };

  return (
    <div className="flex items-center gap-1">
      {/* Connection status indicator */}
      <div className={`w-2 h-2 rounded-full ${statusColor}`} title={statusText} />

      {/* Offline label when disconnected */}
      {connectionStatus === 'disconnected' && (
        <span className="text-xs text-gray-400 ml-0.5">Offline</span>
      )}

      {/* User avatars — clickable to follow viewport */}
      <div className="flex -space-x-2">
        {connectedUsers.slice(0, 5).map((user) => {
          const isFollowing = followingUserId === user.id;
          return (
            <button
              key={user.id}
              onClick={() => handleAvatarClick(user.id)}
              className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs text-white font-medium cursor-pointer transition-all ${
                isFollowing
                  ? 'border-blue-500 ring-2 ring-blue-300 scale-110'
                  : 'border-white hover:scale-105'
              }`}
              style={{ backgroundColor: user.color }}
              aria-label={
                isFollowing
                  ? `Unfollow ${user.name}`
                  : `Follow ${user.name}`
              }
              aria-pressed={isFollowing}
            >
              {user.name.charAt(0).toUpperCase()}
            </button>
          );
        })}
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

export interface CollaborationUser {
  id: string;
  name: string;
  color: string;
  avatarUrl: string | null;
}

export interface RemoteCursor {
  userId: string;
  user: CollaborationUser;
  x: number;
  y: number;
  diagramId: string;
  timestamp: number;
}

export interface RemoteSelection {
  userId: string;
  user: CollaborationUser;
  elementIds: string[];
  diagramId: string;
}

export type SharePermission = 'viewer' | 'editor';

export interface ShareLink {
  id: string;
  projectId: string;
  token: string;
  permission: SharePermission;
  createdBy: string;
  createdAt: number;
  expiresAt: number | null;
  isActive: boolean;
}

export interface PresenceInfo {
  userId: string;
  user: CollaborationUser;
  diagramId: string;
  viewport: {
    scrollX: number;
    scrollY: number;
    zoom: number;
  };
  lastActive: number;
}

export interface CollaborationState {
  isConnected: boolean;
  roomId: string | null;
  localUser: CollaborationUser | null;
  remoteUsers: Map<string, PresenceInfo>;
  remoteCursors: Map<string, RemoteCursor>;
  remoteSelections: Map<string, RemoteSelection>;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'syncing';

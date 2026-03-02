export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'syncing';

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

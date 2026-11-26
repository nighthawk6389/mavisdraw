const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setOnUnauthorized(callback: () => void): void {
  onUnauthorized = callback;
}

/** Deduplicates concurrent refresh attempts — only one inflight at a time. */
let refreshPromise: Promise<boolean> | null = null;

/** Seconds until a JWT expires (0 if unknown or already expired). */
export function tokenSecondsLeft(token: string | null, now = Date.now()): number {
  if (!token) return 0;
  try {
    const payload = token.split('.')[1];
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return json.exp ? Math.max(0, json.exp - now / 1000) : 0;
  } catch {
    return 0;
  }
}

/**
 * An access token good for at least `minSeconds` more, refreshing first if
 * needed. Long-lived connections (the collaboration socket) call this on
 * every (re)connect instead of holding on to the token they started with.
 */
export async function getFreshAccessToken(minSeconds = 60): Promise<string | null> {
  if (accessToken && tokenSecondsLeft(accessToken) > minSeconds) return accessToken;
  await refreshAccessToken();
  return accessToken;
}

/** Force a refresh (e.g. the server rejected the token we had). */
export async function forceRefreshAccessToken(): Promise<boolean> {
  return refreshAccessToken();
}

async function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!response.ok) return false;

      const data = await response.json();
      accessToken = data.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${API_BASE}${path}`;
  // Only declare a JSON body when there is one: Fastify rejects an empty
  // body sent as application/json (e.g. POST /api/share/:token)
  const headers: Record<string, string> = {
    ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string>),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  // If 401, try to refresh the token
  if (response.status === 401 && accessToken) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${accessToken}`;
      response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include',
      });
    } else {
      accessToken = null;
      onUnauthorized?.();
      throw new ApiError('Session expired', 401);
    }
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new ApiError(body.error ?? 'Request failed', response.status);
  }

  // 204 No Content (deletes, mark-as-read) has no JSON to parse
  if (response.status === 204) return undefined as T;
  return response.json();
}

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── Auth API ─────────────────────────────────────────────

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    name: string;
    avatarUrl: string | null;
    createdAt: string;
    updatedAt: string;
  };
  accessToken: string;
}

export async function apiRegister(
  email: string,
  password: string,
  name: string,
): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  });
}

export async function apiLogin(email: string, password: string): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function apiLogout(): Promise<void> {
  await apiFetch('/api/auth/logout', { method: 'POST' });
  accessToken = null;
}

export async function apiGetMe(): Promise<{ user: AuthResponse['user'] }> {
  return apiFetch('/api/auth/me');
}

export async function apiRefreshToken(): Promise<{ accessToken: string }> {
  return apiFetch('/api/auth/refresh', { method: 'POST', body: JSON.stringify({}) });
}

// ── Projects API ─────────────────────────────────────────

export interface ProjectResponse {
  id: string;
  name: string;
  ownerId: string;
  rootDiagramId: string | null;
  isPublic: boolean;
  thumbnailUrl: string | null;
  role?: string;
  createdAt: string;
  updatedAt: string;
}

export async function apiCreateProject(name: string): Promise<{ project: ProjectResponse }> {
  return apiFetch('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function apiListProjects(): Promise<{ projects: ProjectResponse[] }> {
  return apiFetch('/api/projects');
}

export async function apiGetProject(id: string): Promise<{ project: ProjectResponse }> {
  return apiFetch(`/api/projects/${id}`);
}

export async function apiUpdateProject(
  id: string,
  updates: { name?: string; isPublic?: boolean },
): Promise<{ project: ProjectResponse }> {
  return apiFetch(`/api/projects/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export async function apiDeleteProject(id: string): Promise<void> {
  await apiFetch(`/api/projects/${id}`, { method: 'DELETE' });
}

// ── Diagrams API ─────────────────────────────────────────

export interface DiagramResponse {
  id: string;
  projectId: string;
  parentDiagramId: string | null;
  parentPortalId: string | null;
  title: string;
  elements: unknown[];
  viewBackgroundColor: string;
  gridEnabled: boolean;
  gridSize: number;
  renderMode: string;
  layers: unknown[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export async function apiGetDiagram(id: string): Promise<{ diagram: DiagramResponse }> {
  return apiFetch(`/api/diagrams/${id}`);
}

export async function apiUpdateDiagram(
  id: string,
  updates: Partial<Pick<DiagramResponse, 'title' | 'elements' | 'viewBackgroundColor' | 'gridEnabled' | 'gridSize' | 'renderMode' | 'layers'>> & {
    /** Version of each element the edits are based on (lets the server detect conflicts). */
    baseVersions?: Record<string, number>;
    /** Elements deleted since the base. */
    deletedIds?: string[];
  },
): Promise<{ diagram: DiagramResponse; conflicts?: string[] }> {
  return apiFetch(`/api/diagrams/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export async function apiCreateDiagram(input: {
  /** Client-generated id; the server creates idempotently with it. */
  id?: string;
  projectId: string;
  parentDiagramId?: string | null;
  parentPortalId?: string | null;
  title?: string;
}): Promise<{ diagram: DiagramResponse }> {
  return apiFetch('/api/diagrams', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function apiDeleteDiagram(id: string): Promise<void> {
  await apiFetch(`/api/diagrams/${id}`, { method: 'DELETE' });
}

export async function apiSaveDiagram(
  id: string,
  trigger: 'auto' | 'manual' = 'manual',
  label?: string,
): Promise<unknown> {
  return apiFetch(`/api/diagrams/${id}/save`, {
    method: 'POST',
    body: JSON.stringify({ trigger, label }),
  });
}

export interface SnapshotSummary {
  id: string;
  diagramId: string;
  version: number;
  label: string | null;
  trigger: 'auto' | 'manual';
  createdBy: string;
  elementCount: number;
  createdAt: string;
}

export interface SnapshotDetail extends Omit<SnapshotSummary, 'elementCount'> {
  elements: unknown[];
  appState: Record<string, unknown>;
}

export async function apiGetSnapshot(
  diagramId: string,
  snapshotId: string,
): Promise<{ snapshot: SnapshotDetail }> {
  return apiFetch(`/api/diagrams/${diagramId}/snapshots/${snapshotId}`);
}

export async function apiListSnapshots(diagramId: string): Promise<{ snapshots: SnapshotSummary[] }> {
  return apiFetch(`/api/diagrams/${diagramId}/snapshots?limit=100`);
}

export async function apiRestoreSnapshot(
  diagramId: string,
  snapshotId: string,
): Promise<{ diagram: DiagramResponse }> {
  return apiFetch(`/api/diagrams/${diagramId}/snapshots/${snapshotId}/restore`, { method: 'POST' });
}

export async function apiListDiagrams(projectId: string): Promise<{ diagrams: DiagramResponse[] }> {
  return apiFetch(`/api/projects/${projectId}/diagrams`);
}

// ── Sharing API ──────────────────────────────────────────

export interface ShareResponse {
  id: string;
  shareToken: string;
  role: string;
  projectId: string;
  createdAt: string;
}

export async function apiCreateShareLink(
  projectId: string,
  role: 'viewer' | 'editor',
): Promise<{ share: ShareResponse }> {
  return apiFetch(`/api/projects/${projectId}/share`, {
    method: 'POST',
    body: JSON.stringify({ role }),
  });
}

export async function apiJoinViaShareLink(
  token: string,
): Promise<{ projectId: string; role: string }> {
  return apiFetch(`/api/share/${token}`, { method: 'POST' });
}

export interface PermissionResponse {
  id: string;
  userId: string | null;
  email: string | null;
  name: string | null;
  role: string;
  shareToken: string | null;
  createdAt: string;
}

export async function apiListPermissions(
  projectId: string,
): Promise<{ permissions: PermissionResponse[] }> {
  return apiFetch(`/api/projects/${projectId}/permissions`);
}

export async function apiRevokePermission(permissionId: string): Promise<void> {
  await apiFetch(`/api/permissions/${permissionId}`, { method: 'DELETE' });
}

// ── Comments & notifications ───────────────────────────────────────────

export interface Member {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface CommentData {
  id: string;
  threadId: string;
  body: string;
  mentions: string[];
  author: Member;
  createdAt: string;
  editedAt: string | null;
}

export interface CommentThreadData {
  id: string;
  projectId: string;
  diagramId: string;
  elementId: string | null;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdBy: string;
  createdAt: string;
  comments: CommentData[];
}

export interface NotificationData {
  id: string;
  type: 'mention' | 'reply';
  projectId: string;
  projectName: string;
  diagramId: string;
  diagramTitle: string;
  threadId: string;
  commentId: string;
  actor: { id: string; name: string };
  excerpt: string;
  readAt: string | null;
  createdAt: string;
}

export function apiListMembers(projectId: string): Promise<{ members: Member[] }> {
  return apiFetch(`/api/projects/${projectId}/members`);
}

export function apiListComments(projectId: string): Promise<{ threads: CommentThreadData[] }> {
  return apiFetch(`/api/projects/${projectId}/comments`);
}

export function apiCreateThread(
  diagramId: string,
  input: {
    elementId: string | null;
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
    body: string;
    mentions: string[];
  },
): Promise<{ thread: CommentThreadData }> {
  return apiFetch(`/api/diagrams/${diagramId}/comments`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function apiReplyToThread(
  threadId: string,
  body: string,
  mentions: string[],
): Promise<{ thread: CommentThreadData }> {
  return apiFetch(`/api/comment-threads/${threadId}/replies`, {
    method: 'POST',
    body: JSON.stringify({ body, mentions }),
  });
}

export function apiResolveThread(
  threadId: string,
  resolved: boolean,
): Promise<{ thread: CommentThreadData }> {
  return apiFetch(`/api/comment-threads/${threadId}`, {
    method: 'PATCH',
    body: JSON.stringify({ resolved }),
  });
}

export function apiDeleteThread(threadId: string): Promise<void> {
  return apiFetch(`/api/comment-threads/${threadId}`, { method: 'DELETE' });
}

export function apiEditComment(
  commentId: string,
  body: string,
  mentions: string[],
): Promise<{ thread: CommentThreadData }> {
  return apiFetch(`/api/comments/${commentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ body, mentions }),
  });
}

export function apiDeleteComment(commentId: string): Promise<{ thread: CommentThreadData | null }> {
  return apiFetch(`/api/comments/${commentId}`, { method: 'DELETE' });
}

export function apiListNotifications(): Promise<{
  notifications: NotificationData[];
  unreadCount: number;
}> {
  return apiFetch('/api/notifications');
}

export function apiMarkNotificationsRead(ids?: string[]): Promise<void> {
  return apiFetch('/api/notifications/read', {
    method: 'POST',
    body: JSON.stringify(ids ? { ids } : {}),
  });
}

// ── Tours & presenting ─────────────────────────────────────────────────

export interface TourStop {
  id: string;
  diagramId: string;
  /** Saved camera; null means "fit the diagram's content". */
  viewport: { zoom: number; scrollX: number; scrollY: number } | null;
  title: string;
  note: string;
}

export interface PresentationState {
  presenterId: string;
  presenterName: string;
  stop: number;
  updatedAt: number;
}

export function apiGetTour(projectId: string): Promise<{ stops: TourStop[] }> {
  return apiFetch(`/api/projects/${projectId}/tour`);
}

export function apiSaveTour(projectId: string, stops: TourStop[]): Promise<{ stops: TourStop[] }> {
  return apiFetch(`/api/projects/${projectId}/tour`, {
    method: 'PUT',
    body: JSON.stringify({ stops }),
  });
}

export function apiGetPresentation(
  projectId: string,
): Promise<{ presentation: PresentationState | null }> {
  return apiFetch(`/api/projects/${projectId}/presentation`);
}

export function apiSetPresentation(
  projectId: string,
  stop: number | null,
): Promise<{ presentation: PresentationState | null }> {
  return apiFetch(`/api/projects/${projectId}/presentation`, {
    method: 'PUT',
    body: JSON.stringify({ stop }),
  });
}

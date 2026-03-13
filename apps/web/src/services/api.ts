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
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
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
  updates: Partial<Pick<DiagramResponse, 'title' | 'elements' | 'viewBackgroundColor' | 'gridEnabled' | 'gridSize' | 'renderMode' | 'layers'>>,
): Promise<{ diagram: DiagramResponse }> {
  return apiFetch(`/api/diagrams/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export async function apiCreateDiagram(input: {
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

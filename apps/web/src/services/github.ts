import { apiFetch } from './api';

// ── Types ───────────────────────────────────────────────────

export interface GitHubConnection {
  id: string;
  githubUsername: string;
  enterpriseUrl: string | null;
  createdAt: string;
}

export interface GitHubRepo {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  description: string | null;
  private: boolean;
  default_branch: string;
  html_url: string;
  language: string | null;
  updated_at: string;
}

export interface TreeEntry {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

export interface GitHubBranch {
  name: string;
  commit: { sha: string };
  protected: boolean;
}

// ── API Functions ───────────────────────────────────────────

export async function apiGetGitHubAuthUrl(
  enterpriseUrl?: string,
): Promise<{ url: string }> {
  const params = enterpriseUrl ? `?enterpriseUrl=${encodeURIComponent(enterpriseUrl)}` : '';
  return apiFetch(`/api/github/authorize${params}`);
}

export async function apiGitHubCallback(
  code: string,
  enterpriseUrl?: string,
): Promise<{ connection: GitHubConnection }> {
  return apiFetch('/api/github/callback', {
    method: 'POST',
    body: JSON.stringify({ code, enterpriseUrl }),
  });
}

export async function apiGetGitHubStatus(): Promise<{ connections: GitHubConnection[] }> {
  return apiFetch('/api/github/status');
}

export async function apiListGitHubRepos(
  connectionId: string,
  page = 1,
): Promise<{ repos: GitHubRepo[] }> {
  return apiFetch(`/api/github/repos?connectionId=${connectionId}&page=${page}`);
}

export async function apiGetRepoBranches(
  connectionId: string,
  owner: string,
  repo: string,
): Promise<{ branches: GitHubBranch[] }> {
  return apiFetch(
    `/api/github/repos/${owner}/${repo}/branches?connectionId=${connectionId}`,
  );
}

export async function apiGetRepoTree(
  connectionId: string,
  owner: string,
  repo: string,
  path = '',
  ref = 'HEAD',
): Promise<{ entries: TreeEntry[] }> {
  const params = new URLSearchParams({ connectionId, path, ref });
  return apiFetch(`/api/github/repos/${owner}/${repo}/tree?${params}`);
}

export async function apiGetFileContent(
  connectionId: string,
  owner: string,
  repo: string,
  path: string,
  ref = 'HEAD',
): Promise<{ content: string; encoding: string; size: number }> {
  const params = new URLSearchParams({ connectionId, path, ref });
  return apiFetch(`/api/github/repos/${owner}/${repo}/contents?${params}`);
}

export async function apiDisconnectGitHub(connectionId: string): Promise<void> {
  await apiFetch(`/api/github/connections/${connectionId}`, {
    method: 'DELETE',
  });
}

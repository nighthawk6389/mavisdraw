import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { githubConnections } from '../db/schema.js';
import { encrypt, decrypt } from '../utils/encryption.js';

// ── Configuration ───────────────────────────────────────────

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET ?? '';
const DEFAULT_BASE_URL = 'https://api.github.com';
const DEFAULT_AUTH_URL = 'https://github.com';

function getBaseUrl(enterpriseUrl?: string | null): string {
  if (enterpriseUrl) {
    return `${enterpriseUrl.replace(/\/$/, '')}/api/v3`;
  }
  return DEFAULT_BASE_URL;
}

function getAuthUrl(enterpriseUrl?: string | null): string {
  if (enterpriseUrl) {
    return enterpriseUrl.replace(/\/$/, '');
  }
  return DEFAULT_AUTH_URL;
}

// ── Types ───────────────────────────────────────────────────

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
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
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

export interface GitHubBranch {
  name: string;
  commit: { sha: string };
  protected: boolean;
}

export interface GitHubConnection {
  id: string;
  githubUsername: string;
  enterpriseUrl: string | null;
  createdAt: string;
}

// ── Error ───────────────────────────────────────────────────

export class GitHubError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

// ── OAuth Flow ──────────────────────────────────────────────

export function getAuthorizeUrl(redirectUri: string, enterpriseUrl?: string): string {
  if (!GITHUB_CLIENT_ID) {
    throw new GitHubError('GitHub OAuth is not configured', 500);
  }
  const authUrl = getAuthUrl(enterpriseUrl);
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'repo read:user',
    state: nanoid(),
  });
  return `${authUrl}/login/oauth/authorize?${params}`;
}

export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
  enterpriseUrl?: string,
): Promise<{ accessToken: string; scope: string }> {
  const authUrl = getAuthUrl(enterpriseUrl);
  const response = await fetch(`${authUrl}/login/oauth/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    throw new GitHubError('Failed to exchange code for token', 502);
  }

  const data = (await response.json()) as {
    access_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (data.error || !data.access_token) {
    throw new GitHubError(data.error_description ?? 'OAuth token exchange failed', 400);
  }

  return { accessToken: data.access_token, scope: data.scope ?? '' };
}

// ── GitHub API Calls ────────────────────────────────────────

async function githubFetch<T>(
  path: string,
  accessToken: string,
  enterpriseUrl?: string | null,
): Promise<T> {
  const baseUrl = getBaseUrl(enterpriseUrl);
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new GitHubError('GitHub token is invalid or expired', 401);
    }
    if (response.status === 404) {
      throw new GitHubError('GitHub resource not found', 404);
    }
    if (response.status === 403) {
      throw new GitHubError('GitHub rate limit exceeded or access denied', 403);
    }
    throw new GitHubError(`GitHub API error: ${response.status}`, 502);
  }

  return response.json() as Promise<T>;
}

export async function getGitHubUser(
  accessToken: string,
  enterpriseUrl?: string | null,
): Promise<GitHubUser> {
  return githubFetch<GitHubUser>('/user', accessToken, enterpriseUrl);
}

export async function listRepos(
  accessToken: string,
  page = 1,
  perPage = 30,
  enterpriseUrl?: string | null,
): Promise<GitHubRepo[]> {
  return githubFetch<GitHubRepo[]>(
    `/user/repos?sort=updated&per_page=${perPage}&page=${page}&type=all`,
    accessToken,
    enterpriseUrl,
  );
}

export async function getRepoBranches(
  accessToken: string,
  owner: string,
  repo: string,
  enterpriseUrl?: string | null,
): Promise<GitHubBranch[]> {
  return githubFetch<GitHubBranch[]>(
    `/repos/${owner}/${repo}/branches?per_page=100`,
    accessToken,
    enterpriseUrl,
  );
}

export async function getRepoTree(
  accessToken: string,
  owner: string,
  repo: string,
  ref = 'HEAD',
  path = '',
  enterpriseUrl?: string | null,
): Promise<TreeEntry[]> {
  // Use contents API for path-based browsing (simpler, supports nested paths)
  const apiPath = path
    ? `/repos/${owner}/${repo}/contents/${path}?ref=${ref}`
    : `/repos/${owner}/${repo}/contents?ref=${ref}`;

  const result = await githubFetch<
    Array<{ name: string; path: string; type: string; sha: string; size?: number }>
  >(apiPath, accessToken, enterpriseUrl);

  return result.map((item) => ({
    path: item.path,
    mode: item.type === 'dir' ? '040000' : '100644',
    type: (item.type === 'dir' ? 'tree' : 'blob') as 'tree' | 'blob',
    sha: item.sha,
    size: item.size,
  }));
}

export async function getFileContent(
  accessToken: string,
  owner: string,
  repo: string,
  path: string,
  ref = 'HEAD',
  enterpriseUrl?: string | null,
): Promise<{ content: string; encoding: string; size: number }> {
  const result = await githubFetch<{
    content: string;
    encoding: string;
    size: number;
  }>(`/repos/${owner}/${repo}/contents/${path}?ref=${ref}`, accessToken, enterpriseUrl);

  if (result.encoding === 'base64') {
    return {
      content: Buffer.from(result.content, 'base64').toString('utf-8'),
      encoding: 'utf-8',
      size: result.size,
    };
  }

  return result;
}

// ── Connection Management ───────────────────────────────────

export async function saveConnection(
  userId: string,
  accessToken: string,
  scope: string,
  githubUser: GitHubUser,
  enterpriseUrl?: string,
): Promise<GitHubConnection> {
  const encryptedToken = encrypt(accessToken);
  const id = nanoid();
  const now = new Date();

  // Upsert — if user already connected this GitHub account, update the token
  const existing = await db.query.githubConnections.findFirst({
    where: and(
      eq(githubConnections.userId, userId),
      eq(githubConnections.githubUserId, String(githubUser.id)),
    ),
  });

  if (existing) {
    await db
      .update(githubConnections)
      .set({
        accessToken: encryptedToken,
        scope,
        githubUsername: githubUser.login,
        updatedAt: now,
      })
      .where(eq(githubConnections.id, existing.id));

    return {
      id: existing.id,
      githubUsername: githubUser.login,
      enterpriseUrl: existing.enterpriseUrl,
      createdAt: existing.createdAt.toISOString(),
    };
  }

  const [conn] = await db
    .insert(githubConnections)
    .values({
      id,
      userId,
      githubUserId: String(githubUser.id),
      githubUsername: githubUser.login,
      accessToken: encryptedToken,
      scope,
      enterpriseUrl: enterpriseUrl ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return {
    id: conn.id,
    githubUsername: conn.githubUsername,
    enterpriseUrl: conn.enterpriseUrl,
    createdAt: conn.createdAt.toISOString(),
  };
}

export async function getConnectionsForUser(userId: string): Promise<GitHubConnection[]> {
  const connections = await db.query.githubConnections.findMany({
    where: eq(githubConnections.userId, userId),
  });

  return connections.map((c) => ({
    id: c.id,
    githubUsername: c.githubUsername,
    enterpriseUrl: c.enterpriseUrl,
    createdAt: c.createdAt.toISOString(),
  }));
}

export async function getDecryptedToken(
  connectionId: string,
  userId: string,
): Promise<{ accessToken: string; enterpriseUrl: string | null }> {
  const conn = await db.query.githubConnections.findFirst({
    where: and(eq(githubConnections.id, connectionId), eq(githubConnections.userId, userId)),
  });

  if (!conn) {
    throw new GitHubError('GitHub connection not found', 404);
  }

  return {
    accessToken: decrypt(conn.accessToken),
    enterpriseUrl: conn.enterpriseUrl,
  };
}

export async function deleteConnection(connectionId: string, userId: string): Promise<void> {
  const result = await db
    .delete(githubConnections)
    .where(and(eq(githubConnections.id, connectionId), eq(githubConnections.userId, userId)))
    .returning();

  if (result.length === 0) {
    throw new GitHubError('GitHub connection not found', 404);
  }
}

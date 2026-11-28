import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { nanoid } from 'nanoid';
import { config, originOf, type Config } from '../config.js';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { githubConnections } from '../db/schema.js';
import { encrypt, decrypt } from '../utils/encryption.js';

// ── Configuration ───────────────────────────────────────────

const DEFAULT_API_URL = 'https://api.github.com';

export interface ResolvedHost {
  /** Web origin for OAuth (https://github.com or the enterprise origin). */
  authUrl: string;
  /** REST API base. */
  apiUrl: string;
  clientId: string;
  clientSecret: string;
  /** null for github.com. */
  enterpriseUrl: string | null;
}

/**
 * Which GitHub to talk to. Only github.com and the one GitHub Enterprise
 * server configured on this instance are allowed: the URL comes from the
 * client, and the OAuth client secret (and users' tokens) are sent to it, so
 * an arbitrary URL would hand them to whoever runs that host (and let the
 * server be pointed at internal addresses).
 */
export function resolveGitHubHost(
  enterpriseUrl?: string | null,
  github: Config['github'] = config.github,
): ResolvedHost {
  if (!enterpriseUrl) {
    return {
      authUrl: github.cloud.url,
      apiUrl: DEFAULT_API_URL,
      clientId: github.cloud.clientId,
      clientSecret: github.cloud.clientSecret,
      enterpriseUrl: null,
    };
  }
  const origin = originOf(enterpriseUrl);
  if (!origin || !github.enterprise || origin !== github.enterprise.url) {
    throw new GitHubError(
      'That GitHub Enterprise server is not enabled on this MavisDraw instance',
      400,
    );
  }
  return {
    authUrl: origin,
    apiUrl: `${origin}/api/v3`,
    clientId: github.enterprise.clientId,
    clientSecret: github.enterprise.clientSecret,
    enterpriseUrl: origin,
  };
}

// ── OAuth state ─────────────────────────────────────────────

const STATE_TTL_MS = 10 * 60 * 1000;

function stateKey(secret: string): Buffer {
  return createHash('sha256').update(`github-oauth-state:${secret}`).digest();
}

/**
 * The OAuth `state`: who started the flow, against which host, until when,
 * signed. The callback must present it, so a code can't be injected into
 * someone else's session (login CSRF) and the host can't be swapped.
 */
export function createOAuthState(
  userId: string,
  enterpriseUrl: string | null,
  now = Date.now(),
  secret = config.jwtSecret,
): string {
  const payload = Buffer.from(
    JSON.stringify({ u: userId, e: enterpriseUrl, x: now + STATE_TTL_MS, n: nanoid(8) }),
  ).toString('base64url');
  const sig = createHmac('sha256', stateKey(secret)).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/** Check a returned state; gives back the host the flow was started for. */
export function verifyOAuthState(
  state: string,
  userId: string,
  now = Date.now(),
  secret = config.jwtSecret,
): { enterpriseUrl: string | null } {
  const [payload, sig] = state.split('.');
  if (!payload || !sig) throw new GitHubError('Invalid OAuth state', 400);
  const expected = createHmac('sha256', stateKey(secret)).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new GitHubError('Invalid OAuth state', 400);
  }
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    u: string;
    e: string | null;
    x: number;
  };
  if (data.u !== userId)
    throw new GitHubError('This GitHub authorization was started by another account', 400);
  if (data.x < now)
    throw new GitHubError('The GitHub authorization took too long; please try again', 400);
  return { enterpriseUrl: data.e };
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

export function getAuthorizeUrl(
  redirectUri: string,
  userId: string,
  enterpriseUrl?: string | null,
): string {
  const host = resolveGitHubHost(enterpriseUrl);
  if (!host.clientId) {
    throw new GitHubError('GitHub OAuth is not configured', 500);
  }
  const params = new URLSearchParams({
    client_id: host.clientId,
    redirect_uri: redirectUri,
    scope: 'repo read:user',
    state: createOAuthState(userId, host.enterpriseUrl),
  });
  return `${host.authUrl}/login/oauth/authorize?${params}`;
}

export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
  enterpriseUrl?: string | null,
): Promise<{ accessToken: string; scope: string }> {
  const host = resolveGitHubHost(enterpriseUrl);
  const response = await fetch(`${host.authUrl}/login/oauth/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: host.clientId,
      client_secret: host.clientSecret,
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
  const baseUrl = resolveGitHubHost(enterpriseUrl).apiUrl;
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) throw githubErrorFor(response.status, response.headers);

  return response.json() as Promise<T>;
}

/**
 * What a failed GitHub response means. GitHub also answers 403 when it's
 * rate-limiting (with no requests left, or a Retry-After): that's 429 here,
 * so "no access" and "try again later" aren't confused.
 */
export function githubErrorFor(
  status: number,
  headers: { get(name: string): string | null },
): GitHubError {
  if (status === 401) return new GitHubError('GitHub token is invalid or expired', 401);
  if (status === 404) return new GitHubError('GitHub resource not found', 404);
  const limited =
    status === 429 ||
    (status === 403 &&
      (headers.get('x-ratelimit-remaining') === '0' || headers.get('retry-after') !== null));
  if (limited) return new GitHubError('GitHub rate limit exceeded: try again later', 429);
  if (status === 403) return new GitHubError('GitHub access denied', 403);
  return new GitHubError(`GitHub API error: ${status}`, 502);
}

/**
 * What this token may do on a repository: null when it can't see it at
 * all. Reading proves little (anyone can read a public repository); push
 * access is what it takes to speak for a repository, e.g. to have its pull
 * requests checked against a map.
 */
export async function repoAccess(
  accessToken: string,
  owner: string,
  repo: string,
  enterpriseUrl?: string | null,
): Promise<{ push: boolean } | null> {
  try {
    const info = await githubFetch<{
      permissions?: { admin?: boolean; maintain?: boolean; push?: boolean };
    }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      accessToken,
      enterpriseUrl,
    );
    const p = info.permissions ?? {};
    return { push: !!(p.push || p.maintain || p.admin) };
  } catch (err) {
    if (err instanceof GitHubError && (err.statusCode === 404 || err.statusCode === 403)) {
      return null;
    }
    throw err;
  }
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

/** Most manifest files fetched for one snapshot (each is an API call). */
const SNAPSHOT_MAX_MANIFESTS = 80;
const SNAPSHOT_MAX_FILES = 50_000;

export interface RepoSnapshotData {
  name: string;
  ref: string;
  files: string[];
  /** path → contents, for the manifest files only. */
  manifests: Record<string, string>;
  truncated: boolean;
}

/**
 * Everything the repo → map analyzer needs, in as few calls as possible:
 * the whole file tree (one recursive call) plus the contents of the
 * manifest files (package.json, workspace and compose files, go.mod...).
 */
export async function getRepoSnapshot(
  accessToken: string,
  owner: string,
  repo: string,
  ref = 'HEAD',
  isManifest: (path: string) => boolean,
  isRelevant: (path: string) => boolean,
  enterpriseUrl?: string | null,
): Promise<RepoSnapshotData> {
  const tree = await githubFetch<{
    tree: Array<{ path: string; type: string }>;
    truncated: boolean;
  }>(
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    accessToken,
    enterpriseUrl,
  );

  const files = tree.tree
    .filter((e) => e.type === 'blob' && isRelevant(e.path))
    .map((e) => e.path)
    .slice(0, SNAPSHOT_MAX_FILES);
  // Shallow manifests first: they say the most about the architecture
  const wanted = files
    .filter(isManifest)
    .sort((a, b) => a.split('/').length - b.split('/').length)
    .slice(0, SNAPSHOT_MAX_MANIFESTS);

  const manifests: Record<string, string> = {};
  for (let i = 0; i < wanted.length; i += 8) {
    const batch = wanted.slice(i, i + 8);
    const results = await Promise.all(
      batch.map((path) =>
        getFileContent(accessToken, owner, repo, path, ref, enterpriseUrl)
          .then((f) => [path, f.content] as const)
          .catch(() => null),
      ),
    );
    for (const r of results) if (r) manifests[r[0]] = r[1];
  }
  return {
    name: repo,
    ref,
    files,
    manifests,
    truncated: tree.truncated || files.length >= SNAPSHOT_MAX_FILES,
  };
}

// ── Connection Management ───────────────────────────────────

export async function saveConnection(
  userId: string,
  accessToken: string,
  scope: string,
  githubUser: GitHubUser,
  enterpriseUrl?: string | null,
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

/**
 * The person's own token for a GitHub host (github.com, or this server's one
 * Enterprise host), or null if they haven't connected an account there.
 */
export async function getTokenForHost(
  userId: string,
  host: string,
): Promise<{ accessToken: string; enterpriseUrl: string | null } | null> {
  const connections = await db.query.githubConnections.findMany({
    where: eq(githubConnections.userId, userId),
  });
  const conn = connections.find(
    (c) => (c.enterpriseUrl ? originOf(c.enterpriseUrl) : config.github.cloud.url) === host,
  );
  return conn
    ? { accessToken: decrypt(conn.accessToken), enterpriseUrl: conn.enterpriseUrl }
    : null;
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

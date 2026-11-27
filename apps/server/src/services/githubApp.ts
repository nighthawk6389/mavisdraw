import { createHmac, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { GitHubAppConfig } from '../config.js';

/**
 * The GitHub App that checks pull requests against the map: its own
 * credentials (not a person's OAuth token), scoped to the repositories it's
 * installed on, with read access to code and write access to PR comments.
 */

/** GitHub signs each webhook delivery with the app's secret (HMAC-SHA256 of the raw body). */
export function verifyWebhookSignature(
  secret: string,
  rawBody: Buffer,
  header: string | string[] | undefined,
): boolean {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value?.startsWith('sha256=')) return false;
  const expected = Buffer.from(
    `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`,
  );
  const given = Buffer.from(value);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** A short-lived JWT that authenticates as the app itself. */
export function appJwt(cfg: Pick<GitHubAppConfig, 'appId' | 'privateKey'>, now = Date.now()) {
  const iat = Math.floor(now / 1000) - 60; // GitHub's clock may be a little behind
  return jwt.sign({ iat, exp: iat + 9 * 60, iss: cfg.appId }, cfg.privateKey, {
    algorithm: 'RS256',
  });
}

export class GitHubApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(
  cfg: GitHubAppConfig,
  auth: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${cfg.apiUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${auth}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'MavisDraw',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new GitHubApiError(
      res.status,
      `GitHub ${method} ${path} → ${res.status} ${text.slice(0, 200)}`,
    );
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Installation tokens last an hour; reuse them until shortly before they expire. */
const tokens = new Map<string, { token: string; expiresAt: number }>();

export async function installationToken(
  cfg: GitHubAppConfig,
  installationId: number,
  now = Date.now(),
): Promise<string> {
  const key = `${cfg.apiUrl}#${installationId}`;
  const cached = tokens.get(key);
  if (cached && cached.expiresAt - now > 5 * 60_000) return cached.token;
  const { token, expires_at } = await call<{ token: string; expires_at: string }>(
    cfg,
    appJwt(cfg, now),
    'POST',
    `/app/installations/${installationId}/access_tokens`,
  );
  tokens.set(key, { token, expiresAt: Date.parse(expires_at) || now + 50 * 60_000 });
  return token;
}

export interface PrFile {
  filename: string;
  status: string;
  previous_filename?: string;
}

export interface IssueComment {
  id: number;
  body: string;
  user: { login: string; type: string } | null;
}

export interface CheckRun {
  name: string;
  head_sha: string;
  status: 'completed';
  conclusion: 'success' | 'neutral';
  details_url: string;
  output: { title: string; summary: string };
}

/** Files read from pull requests (manifests): bigger ones are skipped. */
const MAX_FILE_BYTES = 256 * 1024;
const MAX_FILE_PAGES = 30; // GitHub lists at most 3,000 files per PR
const MAX_COMMENT_PAGES = 10;

/** What PR checks need from GitHub, as the app installed on a repository. */
export function installationClient(cfg: GitHubAppConfig, installationId: number) {
  const as = async <T>(method: string, path: string, body?: unknown) =>
    call<T>(cfg, await installationToken(cfg, installationId), method, path, body);
  const repoPath = (owner: string, repo: string) =>
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  return {
    async pullRequestFiles(owner: string, repo: string, number: number): Promise<PrFile[]> {
      const files: PrFile[] = [];
      for (let page = 1; page <= MAX_FILE_PAGES; page++) {
        const batch = await as<PrFile[]>(
          'GET',
          `${repoPath(owner, repo)}/pulls/${number}/files?per_page=100&page=${page}`,
        );
        files.push(...batch);
        if (batch.length < 100) break;
      }
      return files;
    },

    /** Every file path at a commit. */
    async tree(owner: string, repo: string, sha: string): Promise<string[]> {
      const { tree } = await as<{ tree: Array<{ path: string; type: string }> }>(
        'GET',
        `${repoPath(owner, repo)}/git/trees/${encodeURIComponent(sha)}?recursive=1`,
      );
      return tree.filter((t) => t.type === 'blob').map((t) => t.path);
    },

    /** A file's text at a commit, or undefined if it isn't there. */
    async content(owner: string, repo: string, path: string, ref: string) {
      try {
        const file = await as<{ content?: string; encoding?: string; size?: number }>(
          'GET',
          `${repoPath(owner, repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`,
        );
        if (!file.content || file.encoding !== 'base64') return undefined;
        // Manifests are small: a huge one is skipped, not parsed
        if ((file.size ?? file.content.length) > MAX_FILE_BYTES) return undefined;
        return Buffer.from(file.content, 'base64').toString('utf8');
      } catch (err) {
        if (err instanceof GitHubApiError && err.status === 404) return undefined;
        throw err;
      }
    },

    async comments(owner: string, repo: string, number: number): Promise<IssueComment[]> {
      const all: IssueComment[] = [];
      for (let page = 1; page <= MAX_COMMENT_PAGES; page++) {
        const batch = await as<IssueComment[]>(
          'GET',
          `${repoPath(owner, repo)}/issues/${number}/comments?per_page=100&page=${page}`,
        );
        all.push(...batch);
        if (batch.length < 100) break;
      }
      return all;
    },

    createComment(owner: string, repo: string, number: number, body: string) {
      return as<IssueComment>('POST', `${repoPath(owner, repo)}/issues/${number}/comments`, {
        body,
      });
    },

    updateComment(owner: string, repo: string, id: number, body: string) {
      return as<IssueComment>('PATCH', `${repoPath(owner, repo)}/issues/comments/${id}`, { body });
    },

    /** A check on a commit (needs the app's "checks: write" permission). */
    createCheckRun(owner: string, repo: string, run: CheckRun) {
      return as<{ id: number }>('POST', `${repoPath(owner, repo)}/check-runs`, run);
    },
  };
}

export type InstallationClient = ReturnType<typeof installationClient>;

/** Exchange the code GitHub returns after "create app from manifest" for the app's credentials. */
export async function convertManifest(apiUrl: string, code: string) {
  const res = await fetch(`${apiUrl}/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: 'POST',
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'MavisDraw' },
  });
  if (!res.ok) throw new GitHubApiError(res.status, `GitHub refused the app code (${res.status})`);
  return (await res.json()) as {
    id: number;
    slug: string;
    name: string;
    html_url: string;
    pem: string;
    webhook_secret: string;
  };
}

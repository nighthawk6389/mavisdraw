import { describe, it, expect, vi } from 'vitest';
import { isTransientFailure, reportCheck } from '../services/prChecks.js';
import { GitHubError, githubErrorFor } from '../services/githubService.js';
import { GitHubApiError, type CheckRun, type InstallationClient } from '../services/githubApp.js';
import type { ProjectImpact } from '../services/prDrift.js';

function client(fail?: Error) {
  const runs: CheckRun[] = [];
  const gh = {
    createCheckRun: vi.fn(async (_o: string, _r: string, run: CheckRun) => {
      if (fail) throw fail;
      runs.push(run);
      return { id: runs.length };
    }),
  } as unknown as InstallationClient;
  return { gh, runs };
}

const impact = (changes: ProjectImpact['changes'], id = 'p1'): ProjectImpact => ({
  project: { id, name: 'Shop' },
  touched: [],
  unmapped: 0,
  changes,
  proposal: null,
});

const input = (impacts: ProjectImpact[], proposals = new Map<string, string>()) => ({
  owner: 'acme',
  repo: 'shop',
  headSha: 'abc123',
  impacts,
  proposals,
  body: '### 🗺️ MavisDraw architecture map',
});

describe('the check on a pull request’s commit', () => {
  it('passes when the map already shows what the PR changes', async () => {
    const { gh, runs } = client();
    await reportCheck(gh, input([impact([{ text: 'adds Redis', removal: false, onMap: true }])]));
    expect(runs[0]).toMatchObject({
      name: 'MavisDraw architecture map',
      head_sha: 'abc123',
      status: 'completed',
      conclusion: 'success',
      output: { title: 'The map is up to date' },
    });
  });

  it('is neutral, never failing, when the map is behind, and links to the proposal', async () => {
    const { gh, runs } = client();
    await reportCheck(
      gh,
      input(
        [
          impact([
            { text: 'adds Kafka', removal: false, onMap: false },
            { text: 'removes Redis', removal: true, onMap: false },
          ]),
        ],
        new Map([['p1', 'prop-1']]),
      ),
    );
    expect(runs[0].conclusion).toBe('neutral');
    expect(runs[0].output.title).toBe('2 architecture changes aren’t on the map yet');
    expect(runs[0].details_url).toMatch(/\/p\/p1\?proposals=open$/);
  });

  it('carries on without a check where the app may not add one, and says why once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { gh } = client(new GitHubApiError(403, 'Resource not accessible by integration'));
    await expect(reportCheck(gh, input([impact([])]))).resolves.toBeUndefined();
    await reportCheck(gh, input([impact([])]));
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    const broken = client(new GitHubApiError(502, 'Bad gateway'));
    await expect(reportCheck(broken.gh, input([impact([])]))).rejects.toThrow('Bad gateway');
  });
});

describe('re-verifying a map’s repository link', () => {
  const headers = (h: Record<string, string> = {}) => ({
    get: (name: string) => h[name.toLowerCase()] ?? null,
  });

  it('tells GitHub rate-limiting apart from no access (both can be 403)', () => {
    expect(githubErrorFor(403, headers({ 'x-ratelimit-remaining': '0' })).statusCode).toBe(429);
    expect(githubErrorFor(403, headers({ 'retry-after': '60' })).statusCode).toBe(429);
    expect(githubErrorFor(429, headers()).statusCode).toBe(429);
    expect(githubErrorFor(403, headers({ 'x-ratelimit-remaining': '4999' })).statusCode).toBe(403);
    expect(githubErrorFor(404, headers()).statusCode).toBe(404);
    expect(githubErrorFor(503, headers()).statusCode).toBe(502);
  });

  it('turns checks off only on a definite no, never because GitHub had a bad moment', () => {
    // Keep the link and try again later
    expect(isTransientFailure(new GitHubError('rate limited', 429))).toBe(true);
    expect(isTransientFailure(new GitHubError('GitHub API error: 503', 502))).toBe(true);
    expect(isTransientFailure(new TypeError('fetch failed'))).toBe(true);
    // The linker's connection is gone, or their token was revoked
    expect(isTransientFailure(new GitHubError('GitHub connection not found', 404))).toBe(false);
    expect(isTransientFailure(new GitHubError('GitHub token is invalid or expired', 401))).toBe(
      false,
    );
    expect(isTransientFailure(new GitHubError('GitHub access denied', 403))).toBe(false);
  });
});

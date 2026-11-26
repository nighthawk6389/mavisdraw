import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../db/client.js', () => ({ db: {} }));
const { getRepoSnapshot } = await import('../services/githubService.js');
const { isManifest, isRelevantPath } = await import('../services/repoFiles.js');

afterEach(() => vi.unstubAllGlobals());

describe('GitHub repo snapshot', () => {
  it('lists the tree in one call and fetches only manifests', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.includes('/git/trees/')) {
          return Response.json({
            truncated: false,
            tree: [
              { path: 'package.json', type: 'blob' },
              { path: 'apps/api/package.json', type: 'blob' },
              { path: 'apps/api/src/index.ts', type: 'blob' },
              { path: 'apps', type: 'tree' },
              { path: 'node_modules/x/package.json', type: 'blob' },
              { path: 'docker-compose.yml', type: 'blob' },
            ],
          });
        }
        const path = decodeURIComponent(url.split('/contents/')[1].split('?')[0]);
        return Response.json({
          content: Buffer.from(`content of ${path}`).toString('base64'),
          encoding: 'base64',
          size: 1,
        });
      }),
    );

    const snap = await getRepoSnapshot('token', 'acme', 'shop', 'main', isManifest, isRelevantPath);
    expect(snap.files).toEqual([
      'package.json',
      'apps/api/package.json',
      'apps/api/src/index.ts',
      'docker-compose.yml',
    ]);
    expect(Object.keys(snap.manifests).sort()).toEqual([
      'apps/api/package.json',
      'docker-compose.yml',
      'package.json',
    ]);
    expect(snap.manifests['package.json']).toBe('content of package.json');
    // 1 tree call + 3 manifests; source files and node_modules never fetched
    expect(calls).toHaveLength(4);
    expect(calls.some((c) => c.includes('index.ts'))).toBe(false);
  });
});

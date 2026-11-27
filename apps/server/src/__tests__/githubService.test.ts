import { describe, it, expect, vi } from 'vitest';

// Set env vars BEFORE importing the module (config is read at load time)
process.env.GITHUB_CLIENT_ID = 'test-client-id';
process.env.GITHUB_CLIENT_SECRET = 'test-client-secret';
process.env.GITHUB_ENTERPRISE_URL = 'https://github.acme.com/';
process.env.GITHUB_ENTERPRISE_CLIENT_ID = 'ghe-client-id';
process.env.GITHUB_ENTERPRISE_CLIENT_SECRET = 'ghe-client-secret';

const {
  getAuthorizeUrl,
  exchangeCodeForToken,
  resolveGitHubHost,
  createOAuthState,
  verifyOAuthState,
  GitHubError,
} = await import('../services/githubService.js');

const REDIRECT = 'http://localhost:3000/oauth/github/callback.html';

describe('githubService', () => {
  describe('getAuthorizeUrl', () => {
    it('returns a github.com OAuth URL with a signed state', () => {
      const url = new URL(getAuthorizeUrl(REDIRECT, 'user-1'));
      expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
      expect(url.searchParams.get('client_id')).toBe('test-client-id');
      expect(url.searchParams.get('scope')).toBe('repo read:user');
      const state = url.searchParams.get('state')!;
      expect(verifyOAuthState(state, 'user-1')).toEqual({ enterpriseUrl: null });
    });

    it('uses the configured enterprise server with its own OAuth app', () => {
      const url = new URL(getAuthorizeUrl(REDIRECT, 'user-1', 'https://github.acme.com'));
      expect(url.origin).toBe('https://github.acme.com');
      expect(url.searchParams.get('client_id')).toBe('ghe-client-id');
      expect(verifyOAuthState(url.searchParams.get('state')!, 'user-1')).toEqual({
        enterpriseUrl: 'https://github.acme.com',
      });
    });

    it('normalises the enterprise URL (trailing slash, path)', () => {
      expect(resolveGitHubHost('https://github.acme.com/some/path/').apiUrl).toBe(
        'https://github.acme.com/api/v3',
      );
    });

    it('refuses any other host', () => {
      for (const host of ['https://evil.example.com', 'http://169.254.169.254', 'not a url']) {
        expect(() => getAuthorizeUrl(REDIRECT, 'user-1', host)).toThrow(GitHubError);
      }
    });
  });

  describe('exchangeCodeForToken', () => {
    it('never sends the client secret to an unknown host', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      await expect(
        exchangeCodeForToken('code', REDIRECT, 'https://evil.example.com'),
      ).rejects.toThrow('not enabled');
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });

  describe('OAuth state', () => {
    it('rejects a tampered, foreign or expired state', () => {
      const state = createOAuthState('user-1', null, 1_000);
      expect(verifyOAuthState(state, 'user-1', 2_000)).toEqual({ enterpriseUrl: null });
      const [payload, sig] = state.split('.');
      const forged = Buffer.from(
        JSON.stringify({ u: 'user-1', e: 'https://evil.example.com', x: 9e15 }),
      ).toString('base64url');
      expect(() => verifyOAuthState(`${forged}.${sig}`, 'user-1', 2_000)).toThrow(
        'Invalid OAuth state',
      );
      // A changed signature (always a different first character: the state is
      // random, so a fixed replacement would sometimes be no change at all)
      const tampered = `${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`;
      expect(() => verifyOAuthState(`${payload}.${tampered}`, 'user-1', 2_000)).toThrow(
        'Invalid OAuth state',
      );
      expect(() => verifyOAuthState(state, 'user-2', 2_000)).toThrow('another account');
      expect(() => verifyOAuthState(state, 'user-1', 1_000 + 11 * 60 * 1000)).toThrow('too long');
      expect(() => verifyOAuthState('garbage', 'user-1')).toThrow('Invalid OAuth state');
    });
  });

  describe('GitHubError', () => {
    it('has correct name and statusCode', () => {
      const err = new GitHubError('Not found', 404);
      expect(err.name).toBe('GitHubError');
      expect(err.message).toBe('Not found');
      expect(err.statusCode).toBe(404);
      expect(err).toBeInstanceOf(Error);
    });

    it('is instanceof Error', () => {
      const err = new GitHubError('Unauthorized', 401);
      expect(err).toBeInstanceOf(Error);
      expect(err.stack).toBeDefined();
    });
  });
});

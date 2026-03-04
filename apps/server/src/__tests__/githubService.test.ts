import { describe, it, expect, vi } from 'vitest';

// Set env vars BEFORE importing the module (module captures them at load time)
process.env.GITHUB_CLIENT_ID = 'test-client-id';
process.env.GITHUB_CLIENT_SECRET = 'test-client-secret';

const { getAuthorizeUrl, GitHubError } = await import('../services/githubService.js');

describe('githubService', () => {
  describe('getAuthorizeUrl', () => {
    it('returns a valid GitHub OAuth URL', () => {
      const url = getAuthorizeUrl('http://localhost:3000/api/github/callback');
      expect(url).toContain('https://github.com/login/oauth/authorize');
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain('scope=repo+read%3Auser');
      expect(url).toContain('redirect_uri=');
    });

    it('uses enterprise URL when provided', () => {
      const url = getAuthorizeUrl(
        'http://localhost:3000/api/github/callback',
        'https://github.example.com',
      );
      expect(url).toContain('https://github.example.com/login/oauth/authorize');
      expect(url).not.toContain('https://github.com');
    });

    it('strips trailing slash from enterprise URL', () => {
      const url = getAuthorizeUrl(
        'http://localhost:3000/api/github/callback',
        'https://github.example.com/',
      );
      expect(url).toContain('https://github.example.com/login/oauth/authorize');
      expect(url).not.toContain('//login');
    });

    it('includes a state parameter for CSRF protection', () => {
      const url = getAuthorizeUrl('http://localhost:3000/api/github/callback');
      expect(url).toContain('state=');
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

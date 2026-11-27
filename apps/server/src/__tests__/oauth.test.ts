import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  accessForScope,
  describeRedirect,
  pkceMatches,
  redirectMatches,
  redirectUriProblem,
  redirectWith,
  scopeForAccess,
} from '../services/oauthService.js';
import { generateRefreshToken, looksLikeToken } from '../services/apiTokenService.js';

/** Agents signing in through the browser: the rules that keep codes going only where they should. */

describe('redirect addresses an agent can register', () => {
  it('accepts https, http back to this computer, and apps’ own schemes', () => {
    expect(redirectUriProblem('https://agent.example/callback')).toBeNull();
    expect(redirectUriProblem('http://localhost:53682/callback')).toBeNull();
    expect(redirectUriProblem('http://127.0.0.1:8080/cb')).toBeNull();
    expect(redirectUriProblem('http://[::1]:8080/cb')).toBeNull();
    expect(redirectUriProblem('cursor://anysphere.cursor-mcp/oauth/callback')).toBeNull();
    expect(redirectUriProblem('vscode://vscode.mcp/callback')).toBeNull();
  });

  it('refuses addresses that would run in, or leak from, MavisDraw’s page', () => {
    expect(redirectUriProblem('javascript:alert(1)')).toMatch(/javascript/);
    expect(redirectUriProblem('JavaScript:alert(1)')).toMatch(/javascript/);
    expect(redirectUriProblem('data:text/html,<script>1</script>')).toMatch(/data/);
    expect(redirectUriProblem('vbscript:msgbox')).not.toBeNull();
    expect(redirectUriProblem('file:///etc/passwd')).not.toBeNull();
    expect(redirectUriProblem('http://evil.example/cb')).toMatch(/https/);
    expect(redirectUriProblem('http://localhost.evil.example/cb')).toMatch(/https/);
    expect(redirectUriProblem('https://agent.example/cb#frag')).toMatch(/fragment/);
    expect(redirectUriProblem('https://user:pw@agent.example/cb')).toMatch(/credentials/);
    expect(redirectUriProblem('not a url')).toMatch(/not a URL/);
  });
});

describe('matching the redirect address at sign-in', () => {
  const registered = ['http://127.0.0.1:33418/callback', 'https://agent.example/cb'];

  it('is exact, except a port back to this computer may change', () => {
    expect(redirectMatches(registered, 'https://agent.example/cb')).toBe(true);
    expect(redirectMatches(registered, 'http://127.0.0.1:50000/callback')).toBe(true);
    expect(redirectMatches(registered, 'http://127.0.0.1/callback')).toBe(true);
  });

  it('refuses anything else', () => {
    expect(redirectMatches(registered, 'https://agent.example/cb/extra')).toBe(false);
    expect(redirectMatches(registered, 'https://agent.example:8443/cb')).toBe(false);
    expect(redirectMatches(registered, 'https://evil.example/cb')).toBe(false);
    expect(redirectMatches(registered, 'http://127.0.0.1:50000/other')).toBe(false);
    expect(redirectMatches(registered, 'http://localhost:33418/callback')).toBe(false);
    expect(redirectMatches(registered, 'http://127.0.0.1:50000/callback?x=1')).toBe(false);
    expect(redirectMatches(registered, 'nonsense')).toBe(false);
  });
});

describe('PKCE', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  it('needs the verifier whose S256 hash was the challenge', () => {
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    expect(pkceMatches(verifier, challenge)).toBe(true);
    expect(pkceMatches(verifier.replace('d', 'e'), challenge)).toBe(false);
    expect(pkceMatches(challenge, challenge)).toBe(false);
  });

  it('refuses verifiers too short to be unguessable, or with odd characters', () => {
    expect(pkceMatches('short', createHash('sha256').update('short').digest('base64url'))).toBe(
      false,
    );
    const odd = `${'a'.repeat(43)} `;
    expect(pkceMatches(odd, createHash('sha256').update(odd).digest('base64url'))).toBe(false);
  });
});

describe('scopes', () => {
  it('proposing unless the agent asked only to read', () => {
    expect(accessForScope(undefined)).toBe('propose');
    expect(accessForScope('')).toBe('propose');
    expect(accessForScope('mcp:read mcp:propose')).toBe('propose');
    expect(accessForScope('mcp:read')).toBe('read');
    expect(accessForScope('openid mcp:read')).toBe('read');
    expect(scopeForAccess('read')).toBe('mcp:read');
    expect(scopeForAccess('propose')).toBe('mcp:read mcp:propose');
  });
});

describe('answering the agent', () => {
  it('adds the code and state to the redirect address, keeping its own query', () => {
    const url = new URL(
      redirectWith('http://127.0.0.1:5000/cb?session=1', { code: 'abc', state: 'x y', no: null }),
    );
    expect(url.searchParams.get('session')).toBe('1');
    expect(url.searchParams.get('code')).toBe('abc');
    expect(url.searchParams.get('state')).toBe('x y');
    expect(url.searchParams.has('no')).toBe(false);
  });

  it('says where approving goes', () => {
    expect(describeRedirect('http://127.0.0.1:5000/cb')).toEqual({
      kind: 'local',
      host: '127.0.0.1:5000',
    });
    expect(describeRedirect('https://agent.example/cb')).toEqual({
      kind: 'web',
      host: 'agent.example',
    });
    expect(describeRedirect('cursor://anysphere.cursor-mcp/cb')).toEqual({
      kind: 'app',
      host: 'cursor',
    });
  });

  it('refresh tokens are never accepted as access tokens', () => {
    expect(looksLikeToken(generateRefreshToken())).toBe(false);
  });
});

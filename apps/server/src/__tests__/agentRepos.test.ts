import { describe, it, expect } from 'vitest';
import { allowedHost, findLinkedRepo, uniqueRepos } from '../services/agentRepos.js';

const GH = 'https://github.com';

describe('the repositories the AI assistant may read', () => {
  it('talks only to github.com (and this server’s Enterprise host, when it has one)', () => {
    expect(allowedHost(null)).toBe(GH);
    expect(allowedHost('https://github.com/')).toBe(GH);
    // No Enterprise host is configured in tests: any other host is refused
    expect(allowedHost('https://github.evil.example')).toBeNull();
    expect(allowedHost('not a url')).toBeNull();
  });

  it('lists each repository once, well-formed and on a known host', () => {
    const repos = uniqueRepos([
      { owner: 'acme', repo: 'payments', ref: 'main', host: GH },
      { owner: 'ACME', repo: 'Payments', ref: null, host: GH },
      { owner: 'acme', repo: '../etc', host: GH },
      { owner: 'acme', repo: 'orders', ref: '  ', host: null },
      { owner: '', repo: 'x', host: GH },
      { owner: 'acme', repo: 'orders', ref: '  ', host: GH },
    ]);
    expect(repos).toEqual([
      { owner: 'acme', repo: 'payments', ref: 'main', host: GH },
      { owner: 'acme', repo: 'orders', ref: null, host: GH },
    ]);
  });

  it('offers at most twenty', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ owner: 'acme', repo: `r${i}`, host: GH }));
    expect(uniqueRepos(many)).toHaveLength(20);
  });

  it('finds what the assistant asks for by owner/name, in any case', () => {
    const repos = uniqueRepos([{ owner: 'acme', repo: 'payments', host: GH }]);
    expect(findLinkedRepo(repos, ' Acme/Payments ')).toEqual(repos[0]);
    expect(findLinkedRepo(repos, 'acme/payments-private')).toBeNull();
    expect(findLinkedRepo(repos, 'payments')).toBeNull();
  });
});

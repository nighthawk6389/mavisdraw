import { describe, it, expect } from 'vitest';
import { loadConfig, parseTrustProxy } from '../config.js';

const strong = 'x'.repeat(40);

describe('configuration', () => {
  it('development works with no setup', () => {
    const { config, problems } = loadConfig({});
    expect(problems).toEqual([]);
    expect(config.jwtSecret).toBeTruthy();
    expect(config.isProduction).toBe(false);
  });

  it('production refuses default or weak secrets', () => {
    const { problems } = loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'short' });
    expect(problems.join('\n')).toMatch(/JWT_SECRET/);
    expect(problems.join('\n')).toMatch(/COOKIE_SECRET/);
    expect(problems.join('\n')).toMatch(/DATABASE_URL/);
    expect(problems.join('\n')).toMatch(/CORS_ORIGIN/);
  });

  it('production with real settings is fine', () => {
    const { problems, config } = loadConfig({
      NODE_ENV: 'production',
      JWT_SECRET: strong,
      COOKIE_SECRET: strong,
      DATABASE_URL: 'postgres://db/x',
      CORS_ORIGIN: 'https://app.example.com',
      TRUST_PROXY: '1',
    });
    expect(problems).toEqual([]);
    expect(config.trustProxy).toBe(1);
  });

  it('production refuses to trust every proxy hop (clients could pick their own address)', () => {
    const { problems } = loadConfig({
      NODE_ENV: 'production',
      JWT_SECRET: strong,
      COOKIE_SECRET: strong,
      DATABASE_URL: 'postgres://db/x',
      CORS_ORIGIN: 'https://app.example.com',
      TRUST_PROXY: 'true',
    });
    expect(problems.join()).toMatch(/TRUST_PROXY=true/);
  });

  it('GitHub in production needs a token encryption key; enterprise needs its own app', () => {
    const base = {
      NODE_ENV: 'production',
      JWT_SECRET: strong,
      COOKIE_SECRET: strong,
      DATABASE_URL: 'x',
      CORS_ORIGIN: 'y',
    };
    expect(loadConfig({ ...base, GITHUB_CLIENT_ID: 'id' }).problems.join()).toMatch(
      /GITHUB_TOKEN_ENCRYPTION_KEY/,
    );
    expect(
      loadConfig({ ...base, GITHUB_ENTERPRISE_URL: 'https://ghe.acme.com' }).problems.join(),
    ).toMatch(/GITHUB_ENTERPRISE_CLIENT_ID/);
    expect(
      loadConfig({
        ...base,
        GITHUB_ENTERPRISE_URL: 'http://ghe.acme.com',
        GITHUB_ENTERPRISE_CLIENT_ID: 'a',
        GITHUB_ENTERPRISE_CLIENT_SECRET: 'b',
        GITHUB_TOKEN_ENCRYPTION_KEY: 'a'.repeat(64),
      }).problems.join(),
    ).toMatch(/https/);
  });

  it('SMTP needs a server URL and a sender', () => {
    expect(loadConfig({ MAIL_PROVIDER: 'smtp' }).problems.join()).toMatch(/SMTP_URL/);
    expect(loadConfig({ MAIL_PROVIDER: 'smtp', SMTP_URL: 'http://x' }).problems.join()).toMatch(
      /SMTP_URL/,
    );
    const ok = loadConfig({
      MAIL_PROVIDER: 'smtp',
      SMTP_URL: 'smtps://u:p@smtp.example.com:465',
      MAIL_FROM: 'MavisDraw <n@example.com>',
    });
    expect(ok.problems).toEqual([]);
    expect(ok.config.mail).toMatchObject({
      provider: 'smtp',
      smtpUrl: 'smtps://u:p@smtp.example.com:465',
    });
  });

  it('secure cookies follow the app URL (a plain-http self-host keeps its session)', () => {
    expect(loadConfig({ APP_URL: 'https://draw.acme.com' }).config.cookieSecure).toBe(true);
    expect(loadConfig({ APP_URL: 'http://10.0.0.5:8080' }).config.cookieSecure).toBe(false);
    expect(
      loadConfig({ APP_URL: 'http://10.0.0.5:8080', COOKIE_SECURE: 'true' }).config.cookieSecure,
    ).toBe(true);
  });

  it('the GitHub sign-in callback defaults to the app URL', () => {
    expect(loadConfig({ APP_URL: 'https://draw.acme.com/' }).config.github.redirectUri).toBe(
      'https://draw.acme.com/oauth/github/callback.html',
    );
  });

  it('parses TRUST_PROXY', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('10.0.0.0/8, 127.0.0.1')).toBe('10.0.0.0/8, 127.0.0.1');
  });
});

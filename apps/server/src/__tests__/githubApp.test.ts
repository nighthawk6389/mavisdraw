import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac, generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { loadConfig } from '../config.js';
import { appJwt, installationToken, verifyWebhookSignature } from '../services/githubApp.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const cfg = {
  appId: '123',
  privateKey,
  webhookSecret: 'a-webhook-secret-of-some-length',
  slug: 'mavisdraw-test',
  apiUrl: 'https://api.github.test',
  webUrl: 'https://github.com',
};

afterEach(() => vi.unstubAllGlobals());

describe('webhook signatures', () => {
  const body = Buffer.from('{"action":"opened"}');
  const sign = (secret: string, b = body) =>
    `sha256=${createHmac('sha256', secret).update(b).digest('hex')}`;

  it('accept a delivery signed with the app secret', () => {
    expect(verifyWebhookSignature(cfg.webhookSecret, body, sign(cfg.webhookSecret))).toBe(true);
  });

  it('reject wrong secrets, altered bodies and missing or malformed headers', () => {
    expect(verifyWebhookSignature(cfg.webhookSecret, body, sign('other'))).toBe(false);
    expect(
      verifyWebhookSignature(
        cfg.webhookSecret,
        Buffer.from('{"action":"closed"}'),
        sign(cfg.webhookSecret),
      ),
    ).toBe(false);
    expect(verifyWebhookSignature(cfg.webhookSecret, body, undefined)).toBe(false);
    expect(verifyWebhookSignature(cfg.webhookSecret, body, 'sha1=abc')).toBe(false);
    expect(verifyWebhookSignature(cfg.webhookSecret, body, 'sha256=short')).toBe(false);
  });
});

describe('app authentication', () => {
  it('signs a short-lived RS256 JWT as the app', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    const token = appJwt(cfg, now);
    const payload = jwt.verify(token, publicKey, {
      algorithms: ['RS256'],
      clockTimestamp: now / 1000,
    }) as { iss: string; iat: number; exp: number };
    expect(payload.iss).toBe('123');
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(600);
    expect(payload.iat).toBeLessThan(now / 1000);
  });

  it('reuses an installation token until shortly before it expires', async () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    const fetchMock = vi.fn(async () =>
      Response.json({
        token: `ghs_${fetchMock.mock.calls.length}`,
        expires_at: new Date(now + 3600_000).toISOString(),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await installationToken(cfg, 42, now)).toBe('ghs_1');
    expect(await installationToken(cfg, 42, now + 30 * 60_000)).toBe('ghs_1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(
      'https://api.github.test/app/installations/42/access_tokens',
    );
    // Five minutes before expiry it asks again
    expect(await installationToken(cfg, 42, now + 56 * 60_000)).toBe('ghs_2');
  });
});

describe('GitHub App configuration', () => {
  it('is off unless all three secrets are set', () => {
    expect(loadConfig({}).config.githubApp).toBeNull();
    const partial = loadConfig({ GITHUB_APP_ID: '1' });
    expect(partial.problems.join('\n')).toMatch(/GITHUB_APP_PRIVATE_KEY/);
  });

  it('accepts a PEM written on one line with \\n escapes', () => {
    const { config, problems } = loadConfig({
      GITHUB_APP_ID: '1',
      GITHUB_APP_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n'),
      GITHUB_APP_WEBHOOK_SECRET: 'secret-secret-secret',
      GITHUB_APP_SLUG: 'my-app',
    });
    expect(problems).toEqual([]);
    expect(config.githubApp?.privateKey).toBe(privateKey);
    expect(config.githubApp?.apiUrl).toBe('https://api.github.com');
  });

  it('rejects something that is not a private key', () => {
    const { problems } = loadConfig({
      GITHUB_APP_ID: '1',
      GITHUB_APP_PRIVATE_KEY: 'not a key',
      GITHUB_APP_WEBHOOK_SECRET: 'secret-secret-secret',
    });
    expect(problems.join('\n')).toMatch(/PEM private key/);
  });
});

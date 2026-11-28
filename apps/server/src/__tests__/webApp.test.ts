import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { loadWebApp, registerWebApp } from '../webApp.js';

/** A built app: the pages, one big hashed script, and a nested page. */
let dir: string;
const script = `console.log(${JSON.stringify('x'.repeat(5000))});`;
const app = Fastify();

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mavis-web-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>app</title>');
  writeFileSync(join(dir, 'embed.html'), '<!doctype html><title>embed</title>');
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'main-abc123.js'), script);
  mkdirSync(join(dir, 'oauth', 'github'), { recursive: true });
  writeFileSync(join(dir, 'oauth', 'github', 'callback.html'), '<!doctype html><title>cb</title>');
  // A file next to the build that must never be reachable
  writeFileSync(join(dir, '..', 'mavis-secret.txt'), 'S3CRET-CONTENTS');

  app.get('/api/health', async () => ({ status: 'ok' }));
  registerWebApp(app, loadWebApp(dir));
  await app.ready();
});

afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(join(dir, '..', 'mavis-secret.txt'), { force: true });
});

const get = (url: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url, headers });

describe('the web app on the API’s own address', () => {
  it('serves the app for its own addresses, refusing other sites’ frames', async () => {
    for (const url of ['/', '/index.html', '/p/abc/d/def', '/invite/tok?x=1', '/connect-agent']) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).toContain('<title>app</title>');
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.headers['content-security-policy']).toBe("frame-ancestors 'self'");
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    }
    const callback = await get('/oauth/github/callback.html');
    expect(callback.body).toContain('<title>cb</title>');
    expect(callback.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('lets other sites frame the embed viewer', async () => {
    const res = await get('/embed.html?token=t');
    expect(res.body).toContain('<title>embed</title>');
    expect(res.headers['x-frame-options']).toBeUndefined();
    expect(res.headers['content-security-policy']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('serves built files for a year, gzipped when the browser takes it', async () => {
    const plain = await get('/assets/main-abc123.js');
    expect(plain.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(plain.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.body).toBe(script);

    const zipped = await get('/assets/main-abc123.js', { 'accept-encoding': 'gzip, deflate, br' });
    expect(zipped.headers['content-encoding']).toBe('gzip');
    expect(zipped.headers.vary).toBe('Accept-Encoding');
    expect(Number(zipped.headers['content-length'])).toBeLessThan(script.length / 10);
    expect(gunzipSync(zipped.rawPayload).toString()).toBe(script);
  });

  it('answers a repeat visit with 304, and HEAD without a body', async () => {
    const first = await get('/assets/main-abc123.js');
    const again = await get('/assets/main-abc123.js', {
      'if-none-match': first.headers.etag as string,
    });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');

    const head = await app.inject({ method: 'HEAD', url: '/' });
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe('');
    expect(head.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('a missing build file is a 404, not the app’s page', async () => {
    for (const url of ['/assets/main-old999.js', '/favicon.png', '/robots.txt']) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(404);
      expect(res.body, url).not.toContain('<title>');
    }
  });

  it('leaves the server’s own paths alone', async () => {
    expect((await get('/api/health')).json()).toEqual({ status: 'ok' });
    for (const url of ['/api/nope', '/api', '/.well-known/oauth-nope', '/collaboration/x']) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(404);
      expect(res.json(), url).toMatchObject({ error: 'Not Found', statusCode: 404 });
    }
    // Only reads: a form posted to an app address isn't answered with the page
    expect((await app.inject({ method: 'POST', url: '/p/abc' })).statusCode).toBe(404);
  });

  it('never reaches outside the build folder', async () => {
    for (const url of [
      '/../mavis-secret.txt',
      '/%2e%2e/mavis-secret.txt',
      '/assets/..%2f..%2fmavis-secret.txt',
      '/%2e%2e%2fmavis-secret.txt',
      '/%E0%A4%A',
    ]) {
      const res = await get(url);
      expect(res.body, url).not.toContain('S3CRET-CONTENTS');
    }
  });

  it('refuses to start from a folder without the built app', () => {
    const empty = mkdtempSync(join(tmpdir(), 'mavis-empty-'));
    try {
      expect(() => loadWebApp(empty)).toThrow(/no index.html/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

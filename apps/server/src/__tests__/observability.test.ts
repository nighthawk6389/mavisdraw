import { describe, it, expect, vi, afterAll } from 'vitest';

const captured: unknown[] = [];
vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  flush: vi.fn(async () => true),
  captureException: vi.fn((e: unknown) => captured.push(e)),
  withScope: vi.fn((fn: (scope: Record<string, unknown>) => void) =>
    fn({ setTag: vi.fn(), setUser: vi.fn() }),
  ),
}));

const { acceptRequestId, checkReadiness, errorResponse, initErrorReporting, reportError } =
  await import('../observability.js');
const { buildApp } = await import('../app.js');

describe('error responses', () => {
  it('server errors never echo internal details; they carry the request id', () => {
    const r = errorResponse(
      new Error('relation "users" does not exist at /app/dist/x.js'),
      'req-1',
    );
    expect(r.status).toBe(500);
    expect(r.body.error).not.toMatch(/relation|\/app/);
    expect(r.body.requestId).toBe('req-1');
  });

  it('client errors keep their message', () => {
    const r = errorResponse({ statusCode: 400, message: 'body/name must be string' }, 'req-2');
    expect(r).toEqual({
      status: 400,
      body: { error: 'body/name must be string', requestId: 'req-2' },
    });
  });

  it('accepts only sane request ids from upstream', () => {
    expect(acceptRequestId('abc-123.x_y')).toBe('abc-123.x_y');
    expect(acceptRequestId('a'.repeat(65))).toBeNull();
    expect(acceptRequestId('bad id\nwith newline')).toBeNull();
    expect(acceptRequestId(undefined)).toBeNull();
  });
});

describe('readiness', () => {
  it('ready when the database answers; not ready when it fails or hangs', async () => {
    expect(await checkReadiness(async () => 1)).toEqual({
      ready: true,
      checks: { database: 'ok' },
    });
    expect(
      (await checkReadiness(async () => Promise.reject(new Error('ECONNREFUSED')))).ready,
    ).toBe(false);
    expect((await checkReadiness(() => new Promise(() => {}), 20)).ready).toBe(false);
  });
});

describe('error reporting', () => {
  it('does nothing without a DSN, reports once configured', () => {
    reportError(new Error('before'));
    expect(captured).toHaveLength(0);
    expect(initErrorReporting({})).toBe(false);
    expect(initErrorReporting({ SENTRY_DSN: 'https://key@o0.ingest.sentry.io/1' })).toBe(true);
    reportError(new Error('boom'), { requestId: 'r', userId: 'u' });
    expect(captured).toHaveLength(1);
  });
});

describe('request ids on the wire', () => {
  const appPromise = buildApp();
  afterAll(async () => (await appPromise).close());

  it('every response carries one, and a valid upstream id is kept', async () => {
    const app = await appPromise;
    const fresh = await app.inject({ method: 'GET', url: '/api/health' });
    expect(fresh.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const kept = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-request-id': 'edge-42' },
    });
    expect(kept.headers['x-request-id']).toBe('edge-42');
  });

  it('rejected requests carry it too', async () => {
    const app = await appPromise;
    const res = await app.inject({ method: 'GET', url: '/api/projects/nope', headers: {} });
    expect(res.statusCode).toBe(401);
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});

import { describe, it, expect, vi, afterAll } from 'vitest';

// Every database call fails the way an unreachable server does
vi.mock('../db/client.js', () => {
  const fail = (): never => {
    throw new Error('connect ECONNREFUSED 10.0.0.5:5432 (relation "users")');
  };
  const proxy: unknown = new Proxy(fail, { get: () => proxy, apply: fail });
  return { db: proxy };
});

const { buildApp } = await import('../app.js');

describe('error handler on real routes', () => {
  const appPromise = buildApp();
  afterAll(async () => (await appPromise).close());

  it("a route's unexpected error is a generic 500 with a request id, not internals", async () => {
    const app = await appPromise;
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'someone@example.com', password: 'whatever-123' },
    });
    expect(res.statusCode).toBe(500);
    const body = res.json() as { error: string; requestId: string };
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|relation/);
    expect(body.requestId).toBe(res.headers['x-request-id']);
  });

  it('validation errors still say what was wrong', async () => {
    const app = await appPromise;
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nope' },
    });
    expect(res.statusCode).toBe(400);
  });
});

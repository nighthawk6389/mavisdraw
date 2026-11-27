import { describe, it, expect, vi, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';

/**
 * Every API route is either on the explicit public list below or refuses a
 * request without a valid session token — before it touches the database.
 * A new route that forgets `requireAuth` fails here instead of shipping open.
 */

// Collect every route the real app registers (and keep the expected
// rejections out of the test output)
const { routes } = vi.hoisted(() => {
  process.env.LOG_LEVEL = 'silent';
  return { routes: [] as Array<{ method: string; url: string }> };
});
vi.spyOn(console, 'error').mockImplementation(() => {});
vi.mock('fastify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fastify')>();
  const create = ((opts?: Parameters<typeof actual.default>[0]) => {
    const app = actual.default(opts);
    app.addHook('onRoute', (route) => {
      for (const method of [route.method].flat()) routes.push({ method, url: route.url });
    });
    return app;
  }) as typeof actual.default;
  return { ...actual, default: create };
});

// Any database access fails loudly: an unauthenticated request that reaches
// the database would come back 500, not 401
vi.mock('../db/client.js', () => {
  const fail = (): never => {
    throw new Error('database touched before authentication');
  };
  const proxy: unknown = new Proxy(fail, { get: () => proxy, apply: fail });
  return { db: proxy };
});

const { buildApp } = await import('../app.js');
const { config } = await import('../config.js');

/** Routes anyone may call (each has its own key, or none is needed). */
const PUBLIC = new Set([
  'GET /api/health',
  'GET /api/ready',
  // What the server can do (e.g. whether it sends email); nothing private
  'GET /api/config',
  'POST /api/auth/register',
  'POST /api/auth/login',
  'POST /api/auth/refresh',
  'POST /api/auth/logout',
  // The emailed confirmation link may be opened signed out (the token is the key)
  'POST /api/auth/verify-email',
  // Describes an invite before sign-in (the token is the key)
  'GET /api/invites/:token',
  // Published embeds (the embed token is the key)
  'GET /api/embed/:token',
  'GET /api/embed/:token/diagrams/:diagramId',
  'GET /api/embed/:token/svg',
  // GitHub App: signed webhooks and the one-time setup pages
  'POST /api/github-app/webhook',
  'GET /api/github-app/setup',
  'GET /api/github-app/created',
  // MCP authenticates with personal access tokens (checked separately below)
  'POST /api/mcp',
  'GET /api/mcp',
  'DELETE /api/mcp',
]);

const appPromise = buildApp();
afterAll(async () => (await appPromise).close());

async function apiRoutes() {
  await (await appPromise).ready();
  return routes.filter((r) => r.url.startsWith('/api/') && r.method !== 'HEAD');
}

/** A concrete URL for a route pattern. */
const urlFor = (pattern: string) => pattern.replace(/:(\w+)/g, 'x$1');

describe('route authentication', () => {
  it('knows the app’s routes (the collector works)', async () => {
    const list = await apiRoutes();
    expect(list.length).toBeGreaterThan(60);
    expect(list).toContainEqual({ method: 'PUT', url: '/api/diagrams/:id' });
  });

  it('the public list only names routes that exist', async () => {
    const keys = new Set((await apiRoutes()).map((r) => `${r.method} ${r.url}`));
    for (const key of PUBLIC) expect(keys, key).toContain(key);
  });

  const badTokens: Record<string, () => string | undefined> = {
    'no Authorization header': () => undefined,
    'a malformed token': () => 'Bearer not-a-jwt',
    'a token signed with another secret': () =>
      `Bearer ${jwt.sign({ userId: 'u1', email: 'a@b.c' }, 'some-other-secret-0123456789abcdef')}`,
    'an expired token': () =>
      `Bearer ${jwt.sign({ userId: 'u1', email: 'a@b.c', exp: Math.floor(Date.now() / 1000) - 60 }, config.jwtSecret)}`,
    'an unsigned (alg: none) token': () =>
      `Bearer ${jwt.sign({ userId: 'u1', email: 'a@b.c' }, '', { algorithm: 'none' })}`,
    // Personal access tokens are for MCP only, never for the REST API
    'a personal access token': () => `Bearer mdw_${'A'.repeat(43)}`,
    'a non-Bearer scheme': () =>
      `Basic ${Buffer.from('demo@mavisdraw.dev:password123').toString('base64')}`,
  };

  for (const [label, header] of Object.entries(badTokens)) {
    it(`every other route refuses ${label} with 401`, async () => {
      const app = await appPromise;
      const failures: string[] = [];
      for (const route of await apiRoutes()) {
        const key = `${route.method} ${route.url}`;
        if (PUBLIC.has(key)) continue;
        const authorization = header();
        const res = await app.inject({
          method: route.method as 'GET',
          url: urlFor(route.url),
          headers: authorization ? { authorization } : {},
          ...(route.method === 'GET' || route.method === 'DELETE' ? {} : { payload: {} }),
        });
        if (res.statusCode !== 401) failures.push(`${key} → ${res.statusCode}`);
      }
      expect(failures).toEqual([]);
    });
  }

  it('MCP refuses a missing or session token (it only takes personal access tokens)', async () => {
    const app = await appPromise;
    const session = jwt.sign({ userId: 'u1', email: 'a@b.c' }, config.jwtSecret);
    for (const headers of [{}, { authorization: `Bearer ${session}` }]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mcp',
        headers: { ...headers, accept: 'application/json, text/event-stream' },
        payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.headers['www-authenticate']).toContain('Bearer');
    }
  });

  it('a valid session token gets past authentication (the 401s above are about the token)', async () => {
    const app = await appPromise;
    const token = jwt.sign({ userId: 'u1', email: 'a@b.c' }, config.jwtSecret);
    const res = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { authorization: `Bearer ${token}` },
    });
    // It reaches the (failing) database: a generic 500, not 401
    expect(res.statusCode).toBe(500);
  });
});

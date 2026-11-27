import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';

const SECRET = 'webhook-secret-for-tests';

vi.mock('../db/client.js', () => ({ db: {} }));
vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>();
  return {
    ...actual,
    config: {
      ...actual.config,
      githubApp: {
        appId: '1',
        privateKey: 'unused',
        webhookSecret: SECRET,
        slug: 'mavisdraw-test',
        apiUrl: 'https://api.github.test',
        webUrl: 'https://github.com',
      },
    },
  };
});
const enqueue = vi.fn(async () => undefined);
vi.mock('../services/prChecks.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/prChecks.js')>()),
  enqueuePullRequestCheck: (...args: unknown[]) => enqueue(...(args as [])),
}));

const { githubAppRoutes } = await import('../routes/githubApp.js');

let app: FastifyInstance;
beforeAll(async () => {
  app = Fastify();
  app.decorate('hocuspocus', { documents: new Map() } as never);
  await app.register(githubAppRoutes);
  await app.ready();
});
afterAll(() => app.close());
beforeEach(() => enqueue.mockClear());

const prEvent = {
  action: 'opened',
  installation: { id: 7 },
  repository: { full_name: 'acme/shop', name: 'shop', owner: { login: 'acme' } },
  pull_request: {
    number: 3,
    title: 'Add billing',
    html_url: 'https://github.com/acme/shop/pull/3',
    base: { sha: 'b' },
    head: { sha: 'h' },
  },
};

function deliver(event: string, payload: unknown, secret = SECRET) {
  const body = JSON.stringify(payload);
  return app.inject({
    method: 'POST',
    url: '/api/github-app/webhook',
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    },
    payload: body,
  });
}

describe('GitHub App webhook', () => {
  it('refuses deliveries not signed with the app secret', async () => {
    const res = await deliver('pull_request', prEvent, 'someone-else');
    expect(res.statusCode).toBe(401);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('answers GitHub’s ping', async () => {
    expect((await deliver('ping', { zen: 'Keep it simple.' })).statusCode).toBe(200);
  });

  it('accepts a pull request at once and checks it in the background', async () => {
    const res = await deliver('pull_request', prEvent);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ accepted: true });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect((enqueue.mock.calls[0] as unknown[])[0]).toMatchObject({
      action: 'opened',
      pull_request: { number: 3 },
    });
  });

  it('ignores events and actions it has nothing to say about', async () => {
    expect((await deliver('pull_request', { ...prEvent, action: 'closed' })).json()).toEqual({
      ignored: true,
    });
    expect((await deliver('issues', { action: 'opened' })).json()).toEqual({ ignored: true });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('serves a setup page that is already done once configured', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/github-app/setup' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.body).toContain('https://github.com/apps/mavisdraw-test/installations/new');
  });
});

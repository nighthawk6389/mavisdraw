import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { getDiagramIds } from '../services/diagramService.js';
import { convertManifest, verifyWebhookSignature } from '../services/githubApp.js';
import {
  CHECKED_ACTIONS,
  enqueuePullRequestCheck,
  type PullRequestEvent,
} from '../services/prChecks.js';
import { signalDocument } from '../ws/hocuspocus.js';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function page(reply: FastifyReply, title: string, body: string, formAction?: string) {
  return reply
    .header('Content-Type', 'text/html; charset=utf-8')
    .header(
      'Content-Security-Policy',
      `default-src 'none'; style-src 'unsafe-inline'; form-action ${formAction ?? "'none'"}`,
    )
    .header('Cache-Control', 'no-store')
    .send(
      `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
        '<style>body{font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;max-width:720px;margin:48px auto;padding:0 16px;color:#1f2937}' +
        'pre{background:#111827;color:#f3f4f6;padding:12px;border-radius:8px;white-space:pre-wrap;word-break:break-all;font-size:12px}' +
        'button,a.button{background:#2563eb;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:15px;text-decoration:none;cursor:pointer}' +
        'code{background:#f3f4f6;padding:1px 4px;border-radius:4px}</style></head><body>' +
        `<h1>${escapeHtml(title)}</h1>${body}</body></html>`,
    );
}

const apiOrigin = (request: FastifyRequest) => `${request.protocol}://${request.host}`;

/**
 * The GitHub App that checks pull requests against the map: its webhook,
 * and a one-time setup flow that registers it on GitHub from a manifest.
 */
export async function githubAppRoutes(app: FastifyInstance): Promise<void> {
  const signal = (projectId: string) => {
    void getDiagramIds(projectId)
      .then((list) => list.forEach((d) => signalDocument(app.hocuspocus, d.id, 'proposals')))
      .catch((err) => app.log.error(err, 'Failed to signal proposal change'));
  };

  // GitHub signs the raw bytes, so this route keeps them (and only this route)
  await app.register(async (scope) => {
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer', bodyLimit: 5 * 1024 * 1024 },
      (_request, body, done) => done(null, body),
    );

    scope.post('/api/github-app/webhook', async (request, reply) => {
      const cfg = config.githubApp;
      if (!cfg) return reply.code(404).send({ error: 'The GitHub App is not set up' });
      const raw = request.body as Buffer;
      if (
        !Buffer.isBuffer(raw) ||
        !verifyWebhookSignature(cfg.webhookSecret, raw, request.headers['x-hub-signature-256'])
      ) {
        return reply.code(401).send({ error: 'Bad signature' });
      }
      let payload: unknown;
      try {
        payload = JSON.parse(raw.toString('utf8'));
      } catch {
        return reply.code(400).send({ error: 'Invalid JSON' });
      }
      const event = request.headers['x-github-event'];
      if (event === 'ping') return reply.send({ ok: true });
      const pr = payload as PullRequestEvent;
      if (event === 'pull_request' && CHECKED_ACTIONS.has(pr.action) && pr.pull_request) {
        // GitHub gives up after 10 seconds: answer now, check in the background
        void enqueuePullRequestCheck(
          pr,
          { cfg, documents: app.hocuspocus.documents, signal },
          request.log,
        );
        return reply.code(202).send({ accepted: true });
      }
      return reply.code(202).send({ ignored: true });
    });
  });

  /** For the editor: can PR checks be turned on, and where to install the app. */
  app.get('/api/github-app/status', { preHandler: [requireAuth] }, async (_request, reply) => {
    const cfg = config.githubApp;
    return reply.send({
      configured: !!cfg,
      installUrl: cfg?.slug ? `${cfg.webUrl}/apps/${cfg.slug}/installations/new` : null,
    });
  });

  // ── One-time setup: register the app on GitHub from a manifest ──

  app.get('/api/github-app/setup', async (request, reply) => {
    const cfg = config.githubApp;
    if (cfg) {
      const install = cfg.slug
        ? `<p><a class="button" href="${escapeHtml(`${cfg.webUrl}/apps/${cfg.slug}/installations/new`)}">Install it on your repositories</a></p>`
        : '';
      return page(
        reply,
        'The GitHub App is set up',
        `<p>Pull requests on repositories it's installed on are checked against their maps.</p>${install}`,
      );
    }
    const { org } = request.query as { org?: string };
    const validOrg = org && /^[A-Za-z0-9-]{1,39}$/.test(org) ? org : null;
    const origin = apiOrigin(request);
    const host = (() => {
      try {
        return new URL(config.appUrl).host;
      } catch {
        return 'MavisDraw';
      }
    })();
    const manifest = {
      name: `MavisDraw ${host}`.slice(0, 34),
      url: config.appUrl,
      description: 'Keeps MavisDraw architecture maps in step with pull requests.',
      hook_attributes: { url: `${origin}/api/github-app/webhook`, active: true },
      redirect_url: `${origin}/api/github-app/created`,
      public: false,
      default_permissions: {
        contents: 'read',
        metadata: 'read',
        pull_requests: 'write',
        // A check on each PR's commit: green when the map is up to date
        checks: 'write',
      },
      default_events: ['pull_request'],
    };
    const github = 'https://github.com';
    const action = validOrg
      ? `${github}/organizations/${validOrg}/settings/apps/new`
      : `${github}/settings/apps/new`;
    return page(
      reply,
      'Set up pull request checks',
      `<p>This registers a GitHub App ${validOrg ? `owned by <b>${escapeHtml(validOrg)}</b>` : 'on your GitHub account'} that reads pull requests on the repositories you install it on and comments with what they change on the map. (For an organization, open this page with <code>?org=your-org</code>.)</p>` +
        `<p>It asks for: read access to code and metadata, write access to pull requests (for its comment), and pull request events.</p>` +
        `<form method="post" action="${escapeHtml(action)}"><input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}"><button type="submit">Create the GitHub App</button></form>`,
      github,
    );
  });

  app.get('/api/github-app/created', async (request, reply) => {
    if (config.githubApp) return reply.redirect('/api/github-app/setup');
    const { code } = request.query as { code?: string };
    if (!code || !/^[\w-]{1,100}$/.test(code)) {
      return page(
        reply,
        'Something went wrong',
        '<p>GitHub didn’t send the app’s code. Start again from the setup page.</p>',
      );
    }
    let created;
    try {
      created = await convertManifest('https://api.github.com', code);
    } catch (err) {
      request.log.error({ err }, 'GitHub App manifest conversion failed');
      return page(
        reply,
        'Something went wrong',
        '<p>GitHub refused the code (it works once, for an hour). Start again from the setup page.</p>',
      );
    }
    const env = [
      `GITHUB_APP_ID=${created.id}`,
      `GITHUB_APP_SLUG=${created.slug}`,
      `GITHUB_APP_WEBHOOK_SECRET=${created.webhook_secret}`,
      `GITHUB_APP_PRIVATE_KEY=${created.pem.trim().replace(/\n/g, '\\n')}`,
    ].join('\n');
    return page(
      reply,
      `Created “${created.name}”`,
      '<ol><li>Add these environment variables to the API service (on Render: the service’s <b>Environment</b> tab), then redeploy. This page is the only place they’re shown.</li></ol>' +
        `<pre>${escapeHtml(env)}</pre>` +
        `<ol start="2"><li>Install the app on the repositories your maps were generated from:</li></ol><p><a class="button" href="${escapeHtml(`${created.html_url}/installations/new`)}">Install ${escapeHtml(created.name)}</a></p>`,
    );
  });
}

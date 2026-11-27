// A stand-in for the parts of GitHub (an Enterprise-style host: REST under
// /api/v3) that pull-request checks use, for the real-backend e2e suite:
// OAuth sign-in (a person connecting GitHub), and the GitHub App. It checks the GitHub App's JWT signature
// (RS256, against the app's public key) before handing out installation
// tokens, and requires those tokens on every repository call, like GitHub.
//
// Tests set a repository up with POST /__test/repo and read the PR comments
// back with GET /__test/comments.

import http from 'node:http';
import { randomBytes, verify } from 'node:crypto';

const port = Number(process.env.FAKE_GITHUB_PORT ?? 3102);
const appId = process.env.FAKE_GITHUB_APP_ID ?? '';
const publicKey = (process.env.FAKE_GITHUB_APP_PUBLIC_KEY ?? '').replace(/\\n/g, '\n');
const botLogin = `${process.env.FAKE_GITHUB_APP_SLUG ?? 'mavisdraw'}[bot]`;

/** owner/repo → { trees: {sha: paths}, contents: {sha: {path: text}}, pulls: {n: files}, comments: {n: [...]}} */
const repos = new Map();
/** Installation tokens (the app), and people's OAuth tokens. */
const tokens = new Set();
const userTokens = new Set();
let nextCommentId = 1;

const b64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function validAppJwt(header) {
  const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return false;
  if (!verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, b64url(s))) return false;
  const claims = JSON.parse(b64url(p).toString('utf8'));
  const now = Math.floor(Date.now() / 1000);
  return String(claims.iss) === appId && claims.exp > now && claims.exp - claims.iat <= 600;
}

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  // Enterprise serves the REST API under /api/v3
  const path = url.pathname.replace(/^\/api\/v3(?=\/)/, '');
  try {
    if (path === '/health') return send(res, 200, { ok: true });

    // ── Test controls ─────────────────────────────────────────
    if (path === '/__test/repo' && req.method === 'POST') {
      const { repo, trees, contents, pulls } = await readBody(req);
      repos.set(repo.toLowerCase(), { trees, contents, pulls, comments: {} });
      return send(res, 200, { ok: true });
    }
    if (path === '/__test/comments' && req.method === 'GET') {
      const r = repos.get(url.searchParams.get('repo').toLowerCase());
      return send(res, 200, { comments: r?.comments[url.searchParams.get('n')] ?? [] });
    }

    // ── A person connecting their GitHub account (OAuth) ──────
    if (path === '/login/oauth/access_token' && req.method === 'POST') {
      const token = `gho_${randomBytes(12).toString('hex')}`;
      userTokens.add(token);
      return send(res, 200, { access_token: token, scope: 'repo', token_type: 'bearer' });
    }
    const bearer = req.headers.authorization?.replace(/^Bearer /, '');
    if (path === '/user' && userTokens.has(bearer)) {
      return send(res, 200, { id: 4242, login: 'octo-e2e', name: 'Octo E2E', avatar_url: '' });
    }
    let r = path.match(/^\/repos\/([^/]+)\/([^/]+)$/);
    if (r && userTokens.has(bearer)) {
      const known = repos.has(
        `${decodeURIComponent(r[1])}/${decodeURIComponent(r[2])}`.toLowerCase(),
      );
      return known
        ? send(res, 200, { full_name: `${r[1]}/${r[2]}`, private: true })
        : send(res, 404, { message: 'Not Found' });
    }

    // ── The GitHub App authenticating ─────────────────────────
    let m = path.match(/^\/app\/installations\/(\d+)\/access_tokens$/);
    if (m && req.method === 'POST') {
      if (!validAppJwt(req.headers.authorization))
        return send(res, 401, { message: 'Bad credentials' });
      const token = `ghs_${randomBytes(12).toString('hex')}`;
      tokens.add(token);
      return send(res, 201, { token, expires_at: new Date(Date.now() + 3600_000).toISOString() });
    }

    // ── Repository calls, as the installation ─────────────────
    const auth = req.headers.authorization?.replace(/^Bearer /, '');
    if (!tokens.has(auth)) return send(res, 401, { message: 'Bad credentials' });
    m = path.match(/^\/repos\/([^/]+)\/([^/]+)\/(.*)$/);
    if (!m) return send(res, 404, { message: 'Not Found' });
    const repo = repos.get(`${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}`.toLowerCase());
    if (!repo) return send(res, 404, { message: 'Not Found' });
    const rest = m[3];

    if ((m = rest.match(/^pulls\/(\d+)\/files$/))) {
      const files = repo.pulls[m[1]] ?? [];
      const page = Number(url.searchParams.get('page') ?? 1);
      const per = Number(url.searchParams.get('per_page') ?? 30);
      return send(res, 200, files.slice((page - 1) * per, page * per));
    }
    if ((m = rest.match(/^git\/trees\/(.+)$/))) {
      const paths = repo.trees[decodeURIComponent(m[1])];
      if (!paths) return send(res, 404, { message: 'Not Found' });
      return send(res, 200, {
        truncated: false,
        tree: paths.map((p) => ({ path: p, type: 'blob' })),
      });
    }
    if ((m = rest.match(/^contents\/(.+)$/))) {
      const file = decodeURIComponent(m[1]);
      const text = repo.contents[url.searchParams.get('ref')]?.[file];
      if (text === undefined) return send(res, 404, { message: 'Not Found' });
      return send(res, 200, { encoding: 'base64', content: Buffer.from(text).toString('base64') });
    }
    if ((m = rest.match(/^issues\/(\d+)\/comments$/))) {
      const list = (repo.comments[m[1]] ??= []);
      if (req.method === 'GET') return send(res, 200, list);
      const { body } = await readBody(req);
      const comment = {
        id: nextCommentId++,
        body,
        edits: 0,
        user: { login: botLogin, type: 'Bot' },
      };
      list.push(comment);
      return send(res, 201, comment);
    }
    if ((m = rest.match(/^issues\/comments\/(\d+)$/)) && req.method === 'PATCH') {
      const { body } = await readBody(req);
      for (const list of Object.values(repo.comments)) {
        const comment = list.find((c) => c.id === Number(m[1]));
        if (comment) {
          comment.body = body;
          comment.edits += 1;
          return send(res, 200, comment);
        }
      }
      return send(res, 404, { message: 'Not Found' });
    }
    return send(res, 404, { message: 'Not Found' });
  } catch (err) {
    send(res, 500, { message: String(err) });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[fake-github] listening on ${port}`);
});

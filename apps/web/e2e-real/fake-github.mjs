// A stand-in for the parts of GitHub (an Enterprise-style host: REST under
// /api/v3) that pull-request checks use, for the real-backend e2e suite:
// OAuth sign-in (a person connecting GitHub), and the GitHub App. It checks the GitHub App's JWT signature
// (RS256, against the app's public key) before handing out installation
// tokens, and requires those tokens on every repository call, like GitHub.
//
// Tests set a repository up with POST /__test/repo and read the PR comments
// back with GET /__test/comments.

import http from 'node:http';
import { createHash, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';

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

// ── A stand-in OpenID Connect provider (single sign-on), under /oidc ──
// Tests choose who "signs in" next with POST /__test/oidc-user.
const oidcClientId = process.env.FAKE_OIDC_CLIENT_ID ?? 'e2e-oidc';
const oidcClientSecret = process.env.FAKE_OIDC_CLIENT_SECRET ?? 'e2e-oidc-secret';
const oidcIssuer = `http://localhost:${port}/oidc`;
const oidcKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const oidcJwk = {
  ...oidcKeys.publicKey.export({ format: 'jwk' }),
  kid: 'fake-1',
  alg: 'RS256',
  use: 'sig',
};
let oidcNextUser = { sub: 'sso-default', email: 'sso-user@acme.example', name: 'SSO User' };
let oidcDeny = false;
/** code → { redirectUri, nonce, challenge, user } (single use) */
const oidcCodes = new Map();
const oidcAccess = new Map();
const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
function signIdToken(claims) {
  const head = enc({ alg: 'RS256', typ: 'JWT', kid: 'fake-1' });
  const body = enc(claims);
  const sig = sign('RSA-SHA256', Buffer.from(`${head}.${body}`), oidcKeys.privateKey).toString(
    'base64url',
  );
  return `${head}.${body}.${sig}`;
}
async function readForm(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

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

    // ── OpenID Connect provider ─────────────────────────────
    if (path === '/__test/oidc-user' && req.method === 'POST') {
      const { deny = false, ...user } = await readBody(req);
      oidcDeny = deny;
      if (user.sub) oidcNextUser = user;
      return send(res, 200, { ok: true });
    }
    if (path === '/oidc/.well-known/openid-configuration') {
      return send(res, 200, {
        issuer: oidcIssuer,
        authorization_endpoint: `${oidcIssuer}/authorize`,
        token_endpoint: `${oidcIssuer}/token`,
        jwks_uri: `${oidcIssuer}/jwks`,
        userinfo_endpoint: `${oidcIssuer}/userinfo`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
        code_challenge_methods_supported: ['S256'],
      });
    }
    if (path === '/oidc/jwks') return send(res, 200, { keys: [oidcJwk] });
    if (path === '/oidc/authorize') {
      const q = url.searchParams;
      const redirectUri = q.get('redirect_uri');
      if (q.get('client_id') !== oidcClientId || !redirectUri) {
        return send(res, 400, { error: 'invalid_client' });
      }
      const back = new URL(redirectUri);
      back.searchParams.set('state', q.get('state') ?? '');
      if (oidcDeny) {
        back.searchParams.set('error', 'access_denied');
      } else {
        if (q.get('code_challenge_method') !== 'S256')
          return send(res, 400, { error: 'pkce_required' });
        const code = randomBytes(16).toString('hex');
        oidcCodes.set(code, {
          redirectUri,
          nonce: q.get('nonce'),
          challenge: q.get('code_challenge'),
          user: oidcNextUser,
        });
        back.searchParams.set('code', code);
      }
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (path === '/oidc/token' && req.method === 'POST') {
      const form = await readForm(req);
      const basic = req.headers.authorization?.startsWith('Basic ')
        ? Buffer.from(req.headers.authorization.slice(6), 'base64')
            .toString('utf8')
            .split(':')
            .map(decodeURIComponent)
        : [form.get('client_id'), form.get('client_secret')];
      if (basic[0] !== oidcClientId || basic[1] !== oidcClientSecret) {
        return send(res, 401, { error: 'invalid_client' });
      }
      const entry = oidcCodes.get(form.get('code') ?? '');
      oidcCodes.delete(form.get('code') ?? '');
      if (!entry || entry.redirectUri !== form.get('redirect_uri')) {
        return send(res, 400, { error: 'invalid_grant' });
      }
      const verifier = form.get('code_verifier') ?? '';
      if (createHash('sha256').update(verifier).digest('base64url') !== entry.challenge) {
        return send(res, 400, { error: 'invalid_grant', error_description: 'PKCE' });
      }
      const now = Math.floor(Date.now() / 1000);
      const access = randomBytes(16).toString('hex');
      oidcAccess.set(access, entry.user);
      return send(res, 200, {
        token_type: 'Bearer',
        expires_in: 300,
        access_token: access,
        id_token: signIdToken({
          iss: oidcIssuer,
          aud: oidcClientId,
          iat: now,
          exp: now + 300,
          nonce: entry.nonce,
          ...entry.user,
        }),
      });
    }
    if (path === '/oidc/userinfo') {
      const user = oidcAccess.get((req.headers.authorization ?? '').replace(/^Bearer /, ''));
      return user ? send(res, 200, user) : send(res, 401, { error: 'invalid_token' });
    }

    // ── Test controls ─────────────────────────────────────────
    if (path === '/__test/repo' && req.method === 'POST') {
      const { repo, trees, contents, pulls, push = true } = await readBody(req);
      repos.set(repo.toLowerCase(), { trees, contents, pulls, push, comments: {}, checkRuns: [] });
      return send(res, 200, { ok: true });
    }
    if (path === '/__test/comments' && req.method === 'GET') {
      const r = repos.get(url.searchParams.get('repo').toLowerCase());
      return send(res, 200, { comments: r?.comments[url.searchParams.get('n')] ?? [] });
    }
    if (path === '/__test/check-runs' && req.method === 'GET') {
      const r = repos.get(url.searchParams.get('repo').toLowerCase());
      const sha = url.searchParams.get('sha');
      return send(res, 200, {
        runs: (r?.checkRuns ?? []).filter((c) => !sha || c.head_sha === sha),
      });
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
      const known = repos.get(
        `${decodeURIComponent(r[1])}/${decodeURIComponent(r[2])}`.toLowerCase(),
      );
      return known
        ? send(res, 200, {
            full_name: `${r[1]}/${r[2]}`,
            private: true,
            permissions: { admin: false, push: known.push, pull: true },
          })
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
    if (rest === 'check-runs' && req.method === 'POST') {
      const run = await readBody(req);
      repo.checkRuns.push(run);
      return send(res, 201, { id: repo.checkRuns.length, ...run });
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

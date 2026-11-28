import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * The built web app, served by this server too (WEB_DIST), so the app and
 * the API share one address: the session cookie is first-party, and each
 * page gets its own headers (the app refuses to be framed by other sites;
 * the embed viewer is meant to be). The self-hosted image does the same with
 * nginx in front.
 *
 * The folder is read once at start. A request only ever looks up a path in
 * that list, so nothing outside the folder can be reached.
 */

export interface WebFile {
  body: Buffer;
  /** The same, gzipped, for text big enough to be worth it. */
  gzip: Buffer | null;
  type: string;
  etag: string;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
};
const COMPRESSIBLE = /^(text\/|application\/(json|manifest\+json|xml)|image\/svg\+xml)/;
const MIN_GZIP_BYTES = 1024;

/** Pages other sites may show in a frame (docs, wikis): the embed viewer only. */
const FRAMEABLE = new Set(['/embed.html']);

/** Every file under `dir`, by the path it's served at ("/assets/main-x.js"). */
export function loadWebApp(dir: string): Map<string, WebFile> {
  const files = new Map<string, WebFile>();
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = join(folder, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const body = readFileSync(full);
      const type = TYPES[extname(entry.name).toLowerCase()] ?? 'application/octet-stream';
      const gzip =
        COMPRESSIBLE.test(type) && body.length >= MIN_GZIP_BYTES
          ? gzipSync(body, { level: 9 })
          : null;
      const etag = `W/"${createHash('sha1').update(body).digest('base64url')}"`;
      files.set(`/${relative(dir, full).split(sep).join('/')}`, { body, gzip, type, etag });
    }
  };
  walk(dir);
  if (!files.has('/index.html')) {
    throw new Error(`WEB_DIST (${dir}) has no index.html: build the web app first`);
  }
  return files;
}

/** The server's own paths: never answered with the app. */
export function isServerPath(path: string): boolean {
  return (
    path === '/api' ||
    path.startsWith('/api/') ||
    path === '/collaboration' ||
    path.startsWith('/collaboration/') ||
    path.startsWith('/.well-known/')
  );
}

/**
 * A build file rather than a page of the app: missing, it's a 404, so a page
 * open from before a deploy that asks for an old chunk fails plainly instead
 * of getting the app's HTML as script.
 */
function isFilePath(path: string): boolean {
  if (path.startsWith('/assets/')) return true;
  const ext = extname(path.slice(path.lastIndexOf('/') + 1)).toLowerCase();
  return ext !== '' && ext in TYPES;
}

/** The request's path, decoded; null when it can't be. */
function pathOf(url: string): string | null {
  const raw = url.split(/[?#]/, 1)[0];
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** Headers for a file served at `key` (the file's own path, not the address asked for). */
export function webHeaders(key: string, file: WebFile): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': file.type,
    etag: file.etag,
    // Built files have content hashes in their names; everything else is
    // checked each time, so a deploy shows at once
    'cache-control': key.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
  };
  if (file.type.startsWith('text/html') && !FRAMEABLE.has(key)) {
    // Inside another site's frame, a click could be someone else's trick
    headers['x-frame-options'] = 'SAMEORIGIN';
    headers['content-security-policy'] = "frame-ancestors 'self'";
  }
  if (file.gzip) headers.vary = 'Accept-Encoding';
  return headers;
}

function send(request: FastifyRequest, reply: FastifyReply, key: string, file: WebFile) {
  reply.headers(webHeaders(key, file));
  const known = request.headers['if-none-match'];
  if (known && known.split(',').some((tag) => tag.trim() === file.etag)) {
    return reply.code(304).send();
  }
  const accepts = String(request.headers['accept-encoding'] ?? '');
  const gzipped = file.gzip && /\bgzip\b/.test(accepts) ? file.gzip : null;
  const body = gzipped ?? file.body;
  if (gzipped) reply.header('content-encoding', 'gzip');
  reply.header('content-length', body.length);
  return reply.code(200).send(request.method === 'HEAD' ? undefined : body);
}

/**
 * Answers what no route did: a file of the app, or the app itself for its
 * own addresses (/p/…, /invite/…; it's a single page). The server's paths
 * keep their usual 404.
 */
export function registerWebApp(app: FastifyInstance, files: Map<string, WebFile>): void {
  const index = files.get('/index.html')!;
  app.setNotFoundHandler((request, reply) => {
    const path = pathOf(request.url);
    if ((request.method === 'GET' || request.method === 'HEAD') && path && !isServerPath(path)) {
      const key = files.has(path)
        ? path
        : path.endsWith('/') && files.has(`${path}index.html`)
          ? `${path}index.html`
          : null;
      if (key) return send(request, reply, key, files.get(key)!);
      if (!isFilePath(path)) return send(request, reply, '/index.html', index);
    }
    return reply.code(404).send({
      message: `Route ${request.method}:${request.url} not found`,
      error: 'Not Found',
      statusCode: 404,
    });
  });
}

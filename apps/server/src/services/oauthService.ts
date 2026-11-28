import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { nanoid } from 'nanoid';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { oauthClients, oauthRequests, type TokenAccess } from '../db/schema.js';
import { hashToken, issueOAuthTokens, type IssuedTokens } from './apiTokenService.js';

/**
 * Signing a coding agent in through the browser (OAuth 2.1, as MCP clients
 * expect): the agent registers itself, opens MavisDraw's consent page, the
 * person approves (choosing what it may do and which maps it sees), and the
 * agent trades the one-time code, with its PKCE verifier, for tokens.
 *
 * Every client is public (no secret: they run on people's machines), so
 * PKCE is required and redirect addresses are checked strictly.
 */

/** The consent page has this long before the agent has to start again. */
export const REQUEST_TTL_MS = 10 * 60 * 1000;
/** After approval the agent has this long to collect its tokens. */
export const CODE_TTL_MS = 60 * 1000;
/** Registrations nobody signed in with are cleared after a day. */
const UNUSED_CLIENT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_REDIRECT_URIS = 10;

export const SCOPES = ['mcp:read', 'mcp:propose'] as const;

// ── Pure helpers ────────────────────────────────────────────

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Schemes that would run or show something in MavisDraw's own page instead of handing off. */
const FORBIDDEN_SCHEMES = new Set([
  'javascript:',
  'data:',
  'vbscript:',
  'file:',
  'blob:',
  'about:',
  'filesystem:',
  'ws:',
  'wss:',
  'ftp:',
  'mailto:',
]);

/**
 * Why a redirect address can't be registered, or null if it can: https
 * anywhere, http only back to this computer, or an app's own scheme
 * (cursor://…, vscode://…). Never a fragment.
 */
export function redirectUriProblem(uri: string): string | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return 'is not a URL';
  }
  if (url.hash || uri.includes('#')) return 'must not have a fragment';
  if (url.username || url.password) return 'must not carry credentials';
  if (FORBIDDEN_SCHEMES.has(url.protocol)) return `can't use ${url.protocol}`;
  if (url.protocol === 'http:' && !LOOPBACK.has(url.hostname)) {
    return 'must use https unless it goes back to this computer (localhost)';
  }
  if (
    url.protocol !== 'https:' &&
    url.protocol !== 'http:' &&
    !/^[a-z][a-z0-9+.-]*:$/.test(url.protocol)
  ) {
    return 'has an unusable scheme';
  }
  return null;
}

const isLoopback = (url: URL) => url.protocol === 'http:' && LOOPBACK.has(url.hostname);

/**
 * Is `requested` one of the registered addresses? Exactly, except that an
 * address back to this computer may use any port (OAuth 2.1: apps pick a
 * free port each time).
 */
export function redirectMatches(registered: readonly string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  let want: URL;
  try {
    want = new URL(requested);
  } catch {
    return false;
  }
  if (!isLoopback(want)) return false;
  return registered.some((r) => {
    try {
      const have = new URL(r);
      return (
        isLoopback(have) &&
        have.hostname === want.hostname &&
        have.pathname === want.pathname &&
        have.search === want.search
      );
    } catch {
      return false;
    }
  });
}

/** Where approving sends the person, for the consent page to say so. */
export function describeRedirect(uri: string): { kind: 'local' | 'web' | 'app'; host: string } {
  const url = new URL(uri);
  if (isLoopback(url)) return { kind: 'local', host: url.host };
  if (url.protocol === 'https:') return { kind: 'web', host: url.host };
  return { kind: 'app', host: url.protocol.slice(0, -1) };
}

/** RFC 7636: the verifier's S256 hash must be the challenge sent at the start. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const expected = createHash('sha256').update(verifier).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** What the agent asked for: proposing updates unless it asked only to read. */
export function accessForScope(scope: string | undefined): TokenAccess {
  const asked = (scope ?? '').split(/\s+/).filter(Boolean);
  return asked.length > 0 && asked.includes('mcp:read') && !asked.includes('mcp:propose')
    ? 'read'
    : 'propose';
}

export const scopeForAccess = (access: TokenAccess) =>
  access === 'read' ? 'mcp:read' : 'mcp:read mcp:propose';

/** The redirect address with the response's parameters added to its query. */
export function redirectWith(
  uri: string,
  params: Record<string, string | null | undefined>,
): string {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  return url.toString();
}

// ── Clients ─────────────────────────────────────────────────

export class OAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface RegisteredClient {
  id: string;
  name: string;
  redirectUris: string[];
  createdAt: Date;
}

/** RFC 7591 dynamic registration (public clients only). */
export async function registerClient(input: {
  name: string | undefined;
  redirectUris: unknown;
}): Promise<RegisteredClient> {
  const uris = input.redirectUris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
    throw new OAuthError(
      'invalid_redirect_uri',
      `Give between 1 and ${MAX_REDIRECT_URIS} redirect_uris`,
    );
  }
  for (const uri of uris) {
    if (typeof uri !== 'string' || uri.length > 2000) {
      throw new OAuthError('invalid_redirect_uri', 'Each redirect_uri must be a URL');
    }
    const problem = redirectUriProblem(uri);
    if (problem) throw new OAuthError('invalid_redirect_uri', `${uri} ${problem}`);
  }
  // Shown on the consent page and in lists: no control characters
  const name = [...(input.name ?? '')]
    .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
    .join('')
    .trim()
    .slice(0, 100);
  // Registrations nobody ever signed in with don't pile up. One that was
  // used is kept even once its connection is gone: the agent keeps its
  // client id, and signing in again must still work
  await db
    .delete(oauthClients)
    .where(
      and(
        isNull(oauthClients.lastUsedAt),
        lt(oauthClients.createdAt, new Date(Date.now() - UNUSED_CLIENT_TTL_MS)),
      ),
    );
  const [row] = await db
    .insert(oauthClients)
    .values({ id: `mdwc_${nanoid(24)}`, name: name || 'A coding agent', redirectUris: uris })
    .returning();
  return row;
}

export async function getClient(id: string): Promise<RegisteredClient | null> {
  if (typeof id !== 'string' || id.length > 64) return null;
  return (await db.query.oauthClients.findFirst({ where: eq(oauthClients.id, id) })) ?? null;
}

// ── The sign-in ─────────────────────────────────────────────

/** A sign-in waiting for the person: its id goes in the consent page's address. */
export async function startRequest(input: {
  client: RegisteredClient;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  access: TokenAccess;
}): Promise<string> {
  const id = randomBytes(24).toString('base64url');
  await db.delete(oauthRequests).where(lt(oauthRequests.expiresAt, new Date()));
  await db.insert(oauthRequests).values({
    id,
    clientId: input.client.id,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    state: input.state,
    requestedAccess: input.access,
    expiresAt: new Date(Date.now() + REQUEST_TTL_MS),
  });
  return id;
}

export interface PendingRequest {
  id: string;
  client: RegisteredClient;
  redirectUri: string;
  state: string | null;
  requestedAccess: TokenAccess;
}

/** A sign-in that's still waiting for an answer, or null (unknown, answered or too old). */
export async function pendingRequest(id: string): Promise<PendingRequest | null> {
  if (typeof id !== 'string' || id.length > 64) return null;
  const row = await db.query.oauthRequests.findFirst({
    where: and(
      eq(oauthRequests.id, id),
      isNull(oauthRequests.userId),
      sql`${oauthRequests.expiresAt} > now()`,
    ),
  });
  if (!row) return null;
  const client = await getClient(row.clientId);
  if (!client) return null;
  return {
    id: row.id,
    client,
    redirectUri: row.redirectUri,
    state: row.state,
    requestedAccess: row.requestedAccess,
  };
}

/**
 * The person approved: record who and what they granted, and hand back the
 * address that gives the agent its one-time code. Only the first answer
 * counts.
 */
export async function approveRequest(
  id: string,
  userId: string,
  grant: { access: TokenAccess; projectIds: string[] | null },
): Promise<string | null> {
  const code = 'mdwa_' + randomBytes(32).toString('base64url');
  const [row] = await db
    .update(oauthRequests)
    .set({
      userId,
      grantedAccess: grant.access,
      grantedProjectIds: grant.projectIds,
      codeHash: hashToken(code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    })
    .where(
      and(
        eq(oauthRequests.id, id),
        isNull(oauthRequests.userId),
        sql`${oauthRequests.expiresAt} > now()`,
      ),
    )
    .returning();
  if (!row) return null;
  return redirectWith(row.redirectUri, { code, state: row.state });
}

/** The person said no: the agent is told so (RFC 6749 access_denied). */
export async function denyRequest(id: string): Promise<string | null> {
  const [row] = await db
    .delete(oauthRequests)
    .where(and(eq(oauthRequests.id, id), isNull(oauthRequests.userId)))
    .returning();
  if (!row) return null;
  return redirectWith(row.redirectUri, {
    error: 'access_denied',
    error_description: 'The person declined to connect this agent',
    state: row.state,
  });
}

/**
 * The agent trades its code for tokens. The code is consumed whatever
 * happens next, so a stolen one can't be retried with guesses.
 */
export async function exchangeCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<IssuedTokens> {
  if (!/^mdwa_[A-Za-z0-9_-]{43}$/.test(input.code)) {
    throw new OAuthError('invalid_grant', 'Unknown or used authorization code');
  }
  const [row] = await db
    .delete(oauthRequests)
    .where(eq(oauthRequests.codeHash, hashToken(input.code)))
    .returning();
  if (!row || !row.userId || !row.grantedAccess || row.expiresAt.getTime() <= Date.now()) {
    throw new OAuthError('invalid_grant', 'Unknown, used or expired authorization code');
  }
  if (row.clientId !== input.clientId) {
    throw new OAuthError('invalid_grant', 'The code was issued to another client');
  }
  if (row.redirectUri !== input.redirectUri) {
    throw new OAuthError('invalid_grant', 'redirect_uri differs from the authorization request');
  }
  if (!pkceMatches(input.codeVerifier, row.codeChallenge)) {
    throw new OAuthError('invalid_grant', 'code_verifier does not match the code challenge');
  }
  const client = await getClient(row.clientId);
  if (!client) throw new OAuthError('invalid_client', 'This client is no longer registered');
  return issueOAuthTokens({
    userId: row.userId,
    clientId: client.id,
    name: client.name,
    scope: { access: row.grantedAccess, projectIds: row.grantedProjectIds },
  });
}

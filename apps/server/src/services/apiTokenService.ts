import { createHash, randomBytes } from 'node:crypto';
import { nanoid } from 'nanoid';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  apiTokens,
  oauthClients,
  projects,
  type TokenAccess,
  type TokenKind,
} from '../db/schema.js';

/**
 * Personal access tokens, for coding agents (Claude Code, Cursor…) that read
 * and propose updates to the map over MCP. Only a hash is stored: the token
 * is shown once, when it's created.
 */

const TOKEN_PREFIX = 'mdw_';
const MAX_TOKENS_PER_USER = 20;
/** Agents signed in through the browser: the oldest connection goes when there are more. */
const MAX_OAUTH_TOKENS_PER_USER = 20;
/** Signed-in agents renew their access token with the refresh token… */
export const OAUTH_ACCESS_TTL_MS = 60 * 60 * 1000;
/** …which lapses if the agent isn't used for this long. */
export const OAUTH_REFRESH_TTL_MS = 60 * 24 * 60 * 60 * 1000;
/** A token limited to projects names at most this many. */
export const MAX_TOKEN_PROJECTS = 50;

export function generateToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

export function generateRefreshToken(): string {
  return 'mdwr_' + randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Shape check before touching the database. */
export function looksLikeToken(value: string): boolean {
  return /^mdw_[A-Za-z0-9_-]{43}$/.test(value);
}

/** "mdw_AbC1…" — enough to tell tokens apart, useless to an attacker. */
export const displayPrefix = (token: string) => token.slice(0, TOKEN_PREFIX.length + 4);

/** What a token may do: everything its owner can, or less. */
export interface TokenScope {
  access: TokenAccess;
  /** null: every project the owner can open. */
  projectIds: string[] | null;
}

export interface TokenSummary {
  id: string;
  name: string;
  prefix: string;
  kind: TokenKind;
  access: TokenAccess;
  /** The projects it's limited to (names as they are now), or null for all. */
  projects: Array<{ id: string; name: string }> | null;
  lastUsedAt: string | null;
  createdAt: string;
}

type TokenRow = typeof apiTokens.$inferSelect;

const summarize = (row: TokenRow, names: Map<string, string>): TokenSummary => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  kind: row.kind,
  access: row.access,
  projects: row.projectIds
    ? row.projectIds.flatMap((id) => {
        const name = names.get(id);
        return name === undefined ? [] : [{ id, name }];
      })
    : null,
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

async function projectNames(rows: TokenRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.flatMap((r) => r.projectIds ?? []))];
  if (ids.length === 0) return new Map();
  const found = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(inArray(projects.id, ids));
  return new Map(found.map((p) => [p.id, p.name]));
}

/** Personal tokens and signed-in agents (whose refresh token hasn't lapsed). */
export async function listTokens(userId: string): Promise<TokenSummary[]> {
  const rows = (
    await db.query.apiTokens.findMany({
      where: eq(apiTokens.userId, userId),
      orderBy: [desc(apiTokens.createdAt)],
    })
  ).filter((r) => !r.refreshExpiresAt || r.refreshExpiresAt.getTime() > Date.now());
  const names = await projectNames(rows);
  return rows.map((r) => summarize(r, names));
}

export class TooManyTokensError extends Error {
  constructor() {
    super(`You can have at most ${MAX_TOKENS_PER_USER} tokens. Revoke one you no longer use.`);
  }
}

/** Create a token; the returned `token` is the only time it's ever visible. */
export async function createToken(
  userId: string,
  name: string,
  scope: TokenScope = { access: 'propose', projectIds: null },
): Promise<{ token: string; summary: TokenSummary }> {
  const existing = await db.query.apiTokens.findMany({
    where: and(eq(apiTokens.userId, userId), eq(apiTokens.kind, 'personal')),
    columns: { id: true },
  });
  if (existing.length >= MAX_TOKENS_PER_USER) throw new TooManyTokensError();
  const token = generateToken();
  const [row] = await db
    .insert(apiTokens)
    .values({
      id: nanoid(),
      userId,
      name,
      tokenHash: hashToken(token),
      prefix: displayPrefix(token),
      access: scope.access,
      projectIds: scope.projectIds,
    })
    .returning();
  return { token, summary: summarize(row, await projectNames([row])) };
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  access: TokenAccess;
}

/**
 * An agent signed in through the browser: a short-lived access token and a
 * refresh token. Signing the same app in again replaces its earlier
 * connection, and beyond the limit the least recently used one goes.
 */
export async function issueOAuthTokens(input: {
  userId: string;
  clientId: string;
  name: string;
  scope: TokenScope;
}): Promise<IssuedTokens> {
  const accessToken = generateToken();
  const refreshToken = generateRefreshToken();
  const now = Date.now();
  await db.transaction(async (tx) => {
    // This app's earlier connection, and any that lapsed
    await tx
      .delete(apiTokens)
      .where(
        and(
          eq(apiTokens.userId, input.userId),
          or(eq(apiTokens.clientId, input.clientId), sql`${apiTokens.refreshExpiresAt} <= now()`),
        ),
      );
    const others = await tx
      .select({ id: apiTokens.id })
      .from(apiTokens)
      .where(and(eq(apiTokens.userId, input.userId), eq(apiTokens.kind, 'oauth')))
      .orderBy(asc(sql`coalesce(${apiTokens.lastUsedAt}, ${apiTokens.createdAt})`));
    const excess = others.length - (MAX_OAUTH_TOKENS_PER_USER - 1);
    if (excess > 0) {
      await tx.delete(apiTokens).where(
        inArray(
          apiTokens.id,
          others.slice(0, excess).map((o) => o.id),
        ),
      );
    }
    await tx
      .update(oauthClients)
      .set({ lastUsedAt: new Date(now) })
      .where(eq(oauthClients.id, input.clientId));
    await tx.insert(apiTokens).values({
      id: nanoid(),
      userId: input.userId,
      name: input.name.slice(0, 100),
      kind: 'oauth',
      clientId: input.clientId,
      access: input.scope.access,
      projectIds: input.scope.projectIds,
      tokenHash: hashToken(accessToken),
      prefix: displayPrefix(accessToken),
      expiresAt: new Date(now + OAUTH_ACCESS_TTL_MS),
      refreshHash: hashToken(refreshToken),
      refreshExpiresAt: new Date(now + OAUTH_REFRESH_TTL_MS),
    });
  });
  return {
    accessToken,
    refreshToken,
    expiresIn: OAUTH_ACCESS_TTL_MS / 1000,
    access: input.scope.access,
  };
}

/**
 * Trade a refresh token for new tokens. Each refresh token works once (the
 * update only matches the current one, so two racing refreshes can't both
 * win); null if it's unknown, used, lapsed or belongs to another app.
 */
export async function refreshOAuthTokens(
  refreshToken: string,
  clientId: string,
): Promise<IssuedTokens | null> {
  if (!/^mdwr_[A-Za-z0-9_-]{43}$/.test(refreshToken)) return null;
  const accessToken = generateToken();
  const next = generateRefreshToken();
  const now = Date.now();
  const [row] = await db
    .update(apiTokens)
    .set({
      tokenHash: hashToken(accessToken),
      prefix: displayPrefix(accessToken),
      expiresAt: new Date(now + OAUTH_ACCESS_TTL_MS),
      refreshHash: hashToken(next),
      refreshExpiresAt: new Date(now + OAUTH_REFRESH_TTL_MS),
    })
    .where(
      and(
        eq(apiTokens.refreshHash, hashToken(refreshToken)),
        eq(apiTokens.clientId, clientId),
        sql`${apiTokens.refreshExpiresAt} > now()`,
      ),
    )
    .returning({ access: apiTokens.access });
  if (!row) return null;
  await db
    .update(oauthClients)
    .set({ lastUsedAt: new Date(now) })
    .where(eq(oauthClients.id, clientId));
  return {
    accessToken,
    refreshToken: next,
    expiresIn: OAUTH_ACCESS_TTL_MS / 1000,
    access: row.access,
  };
}

/** RFC 7009: the access or refresh token given ends its connection (unknown tokens are fine). */
export async function revokeByToken(token: string): Promise<void> {
  const hash = hashToken(token);
  await db
    .delete(apiTokens)
    .where(sql`${apiTokens.tokenHash} = ${hash} or ${apiTokens.refreshHash} = ${hash}`);
}

export async function revokeToken(userId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(apiTokens)
    .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId)))
    .returning({ id: apiTokens.id });
  return deleted.length > 0;
}

export interface TokenIdentity extends TokenScope {
  tokenId: string;
  userId: string;
  tokenName: string;
}

/** Recording every use would write on every request: once a minute is plenty. */
const LAST_USED_RESOLUTION_MS = 60_000;

/** Who an `Authorization: Bearer mdw_…` header belongs to, or null. */
export async function authenticateToken(header: string | undefined): Promise<TokenIdentity | null> {
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (!looksLikeToken(token)) return null;
  const row = await db.query.apiTokens.findFirst({
    where: eq(apiTokens.tokenHash, hashToken(token)),
  });
  if (!row) return null;
  const now = Date.now();
  if (row.expiresAt && row.expiresAt.getTime() <= now) return null;
  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
    await db
      .update(apiTokens)
      .set({ lastUsedAt: new Date(now) })
      .where(eq(apiTokens.id, row.id));
  }
  return {
    tokenId: row.id,
    userId: row.userId,
    tokenName: row.name,
    access: row.access,
    projectIds: row.projectIds,
  };
}

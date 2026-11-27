import { createHash, randomBytes } from 'node:crypto';
import { nanoid } from 'nanoid';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { apiTokens } from '../db/schema.js';

/**
 * Personal access tokens, for coding agents (Claude Code, Cursor…) that read
 * and propose updates to the map over MCP. Only a hash is stored: the token
 * is shown once, when it's created.
 */

const TOKEN_PREFIX = 'mdw_';
const MAX_TOKENS_PER_USER = 20;

export function generateToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString('base64url');
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

export interface TokenSummary {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

const summarize = (row: typeof apiTokens.$inferSelect): TokenSummary => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

export async function listTokens(userId: string): Promise<TokenSummary[]> {
  const rows = await db.query.apiTokens.findMany({
    where: eq(apiTokens.userId, userId),
    orderBy: [desc(apiTokens.createdAt)],
  });
  return rows.map(summarize);
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
): Promise<{ token: string; summary: TokenSummary }> {
  const existing = await db.query.apiTokens.findMany({
    where: eq(apiTokens.userId, userId),
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
    })
    .returning();
  return { token, summary: summarize(row) };
}

export async function revokeToken(userId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(apiTokens)
    .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId)))
    .returning({ id: apiTokens.id });
  return deleted.length > 0;
}

export interface TokenIdentity {
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
  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
    await db
      .update(apiTokens)
      .set({ lastUsedAt: new Date(now) })
      .where(eq(apiTokens.id, row.id));
  }
  return { tokenId: row.id, userId: row.userId, tokenName: row.name };
}

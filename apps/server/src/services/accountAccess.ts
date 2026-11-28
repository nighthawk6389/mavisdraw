import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { apiTokens, oauthRequests, sessions } from '../db/schema.js';
import { revokeIssuedTokens } from './accessRevocation.js';

/**
 * End everything that lets anyone in to this account, except a fresh sign-in:
 * sessions (refresh tokens), access tokens already issued, personal access
 * tokens, signed-in coding agents, and agent sign-ins approved but not yet
 * collected. Used when the account is taken back by the owner of its address
 * (a password reset, or the first single sign-on into an unconfirmed
 * account). Open live sockets are closed by the caller (`disconnectUser`).
 */
export async function endAccountAccess(userId: string): Promise<void> {
  revokeIssuedTokens(userId);
  await db.transaction(async (tx) => {
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx.delete(apiTokens).where(eq(apiTokens.userId, userId));
    await tx.delete(oauthRequests).where(eq(oauthRequests.userId, userId));
  });
}

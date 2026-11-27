import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { sendMail, verifyEmail } from './mailer.js';
import { claimInvitesForEmail } from './workspaceService.js';

/**
 * Proving an email address is yours. Invites are sent to addresses, so an
 * account only receives them once it has confirmed its address — otherwise
 * anyone could register someone else's address first and collect every
 * project and workspace shared with it.
 *
 * The link carries a signed, expiring token (no table needed): the user id,
 * the email it was sent to, and an expiry, HMAC'd with a key derived from
 * the JWT secret.
 */

const TTL_MS = 3 * 24 * 60 * 60 * 1000;

const key = () => createHmac('sha256', config.jwtSecret).update('email-verification').digest();

export function createVerificationToken(userId: string, email: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, e: email, x: now + TTL_MS })).toString(
    'base64url',
  );
  const sig = createHmac('sha256', key()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export class VerificationError extends Error {}

export function readVerificationToken(
  token: string,
  now = Date.now(),
): { userId: string; email: string } {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) throw new VerificationError('This confirmation link is broken.');
  const expected = createHmac('sha256', key()).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new VerificationError('This confirmation link is broken.');
  }
  let data: { u?: unknown; e?: unknown; x?: unknown };
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new VerificationError('This confirmation link is broken.');
  }
  if (typeof data.u !== 'string' || typeof data.e !== 'string' || typeof data.x !== 'number') {
    throw new VerificationError('This confirmation link is broken.');
  }
  if (data.x < now) {
    throw new VerificationError('This confirmation link has expired. Send yourself a new one.');
  }
  return { userId: data.u, email: data.e };
}

/** Email a confirmation link. Resolves to whether it was handed to the mail provider. */
export async function sendVerificationEmail(user: {
  id: string;
  email: string;
  name: string;
}): Promise<boolean> {
  const link = `${config.appUrl}/verify-email?token=${encodeURIComponent(
    createVerificationToken(user.id, user.email),
  )}`;
  return sendMail(verifyEmail({ to: user.email, name: user.name, link }));
}

/**
 * The address is theirs: record it, and hand over everything that was
 * waiting for it. Returns how many invites were claimed.
 */
export async function markEmailVerified(userId: string, email: string): Promise<number> {
  await db
    .update(users)
    .set({ emailVerifiedAt: new Date() })
    .where(eq(users.id, userId));
  return claimInvitesForEmail(userId, email);
}

/** Confirm from a link: the token must still match the account's current email. */
export async function confirmEmail(token: string): Promise<{ userId: string; claimed: number }> {
  const { userId, email } = readVerificationToken(token);
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user || user.email !== email) {
    throw new VerificationError('This confirmation link is for a different address.');
  }
  return { userId: user.id, claimed: await markEmailVerified(user.id, user.email) };
}

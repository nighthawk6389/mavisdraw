import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { isMailEnabled, passwordResetEmail, sendMail } from './mailer.js';
import { readToken, signToken, SignedTokenError } from './signedToken.js';
import { claimInvitesForEmail } from './workspaceService.js';
import { endAccountAccess } from './accountAccess.js';
import { allowEmail } from './emailLimits.js';

/**
 * Resetting a forgotten password through a link sent to the account's
 * address. It's also how the real owner of an address takes back an account
 * someone else registered with it: following the link proves the inbox is
 * theirs, so the reset confirms the address, signs every session out, and
 * hands over the invitations waiting for it.
 *
 * Links last an hour and work once: they carry a fingerprint of the password
 * they replace, so they stop working as soon as the password changes.
 */

const PURPOSE = 'password-reset';
const TTL_MS = 60 * 60 * 1000;
const BCRYPT_ROUNDS = 10;

export class PasswordResetError extends Error {}

/** Changes whenever the password does (or is first set). */
export function passwordFingerprint(passwordHash: string | null): string {
  return createHash('sha256')
    .update(passwordHash ?? 'no-password')
    .digest('base64url')
    .slice(0, 22);
}

export function createResetToken(
  user: { id: string; passwordHash: string | null },
  now = Date.now(),
): string {
  return signToken(PURPOSE, { u: user.id, f: passwordFingerprint(user.passwordHash) }, TTL_MS, now);
}

export function readResetToken(
  token: string,
  now = Date.now(),
): { userId: string; fingerprint: string } {
  try {
    const { u, f } = readToken(PURPOSE, token, now);
    if (!u || !f) throw new SignedTokenError('broken');
    return { userId: u, fingerprint: f };
  } catch (err) {
    if (err instanceof SignedTokenError && err.message === 'expired') {
      throw new PasswordResetError('This reset link has expired. Ask for a new one.');
    }
    throw new PasswordResetError('This reset link is broken. Ask for a new one.');
  }
}

export function resetLink(token: string): string {
  return `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
}

/** A reset link for this address, or null if there's no such account. */
export async function createResetLinkFor(email: string): Promise<string | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.email, email.trim().toLowerCase()),
  });
  return user ? resetLink(createResetToken(user)) : null;
}

/**
 * Email a reset link if the account exists. The answer is the same either
 * way, so the form can't be used to find out who has an account.
 */
export async function requestPasswordReset(email: string, requestedFrom: string): Promise<void> {
  if (!isMailEnabled()) return;
  const user = await db.query.users.findFirst({
    where: eq(users.email, email.trim().toLowerCase()),
  });
  if (!user) return;
  // Asked for too often (for this inbox, or from this client): no more mail today
  if (!allowEmail('reset', requestedFrom, user.email)) return;
  await sendMail(passwordResetEmail({ to: user.email, link: resetLink(createResetToken(user)) }));
}

/** Set the new password; every session (anyone's who had one) is signed out. */
export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<{ userId: string; email: string }> {
  const { userId, fingerprint } = readResetToken(token);
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new PasswordResetError('This reset link is broken. Ask for a new one.');
  if (passwordFingerprint(user.passwordHash) !== fingerprint) {
    throw new PasswordResetError('This reset link was already used. Ask for a new one.');
  }
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await db
    .update(users)
    .set({
      passwordHash,
      // Following the link proved the address is theirs
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));
  // Whoever had the account until now (a squatter on the address, or someone
  // who got the password) loses every way back in: sessions, tokens, agents
  await endAccountAccess(user.id);
  await claimInvitesForEmail(user.id, user.email);
  return { userId: user.id, email: user.email };
}

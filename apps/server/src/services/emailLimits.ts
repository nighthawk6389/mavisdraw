/**
 * Caps on the email that people can make this server send to others
 * (invites, @mentions, and password-reset and confirmation links anyone
 * can ask for), so that nobody can use it to send mail in bulk or to flood
 * one inbox: per sender and per recipient, in rolling windows. For resets
 * and confirmations, asked for before anyone is signed in, the sender is
 * the client's address.
 *
 * Over a cap, only the email is skipped: the invite link still works (the
 * inviter is shown it to send themselves) and in-app notifications still
 * arrive. Kept in this process's memory, like the other rate limits.
 */

export type EmailKind = 'invite' | 'mention' | 'reset' | 'verify';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

interface Window {
  max: number;
  ms: number;
}

export const EMAIL_LIMITS: Record<EmailKind, { perSender?: Window; perRecipient: Window }> = {
  // Inviting a team is a burst, but not hundreds an hour; one address gets a
  // few invitations a day, from anyone
  invite: { perSender: { max: 50, ms: HOUR }, perRecipient: { max: 5, ms: DAY } },
  mention: { perSender: { max: 60, ms: HOUR }, perRecipient: { max: 30, ms: HOUR } },
  // Someone locked out tries a few times; nobody needs dozens of links a day
  reset: { perSender: { max: 30, ms: HOUR }, perRecipient: { max: 5, ms: DAY } },
  // Sent at sign-up, which is already rate-limited per client (and many
  // people may sign up from one office's address): capped per inbox only
  verify: { perRecipient: { max: 5, ms: DAY } },
};

const sent = new Map<string, number[]>();
const MAX_KEYS = 50_000;

function recent(key: string, windowMs: number, now: number): number[] {
  const times = (sent.get(key) ?? []).filter((t) => now - t < windowMs);
  if (times.length > 0) sent.set(key, times);
  else sent.delete(key);
  return times;
}

/** Drop keys with nothing in any window (bounded memory under abuse). */
function sweep(now: number): void {
  if (sent.size < MAX_KEYS) return;
  for (const [key, times] of sent) {
    if (times.every((t) => now - t >= DAY)) sent.delete(key);
  }
}

/**
 * May `senderId` email `recipient` now? If so, it's counted: call this
 * right before sending, once per email.
 */
export function allowEmail(
  kind: EmailKind,
  senderId: string,
  recipient: string,
  now = Date.now(),
): boolean {
  const limits = EMAIL_LIMITS[kind];
  const bySender = `${kind}:from:${senderId}`;
  const byRecipient = `${kind}:to:${recipient.trim().toLowerCase()}`;
  const { perSender, perRecipient } = limits;
  if (perSender && recent(bySender, perSender.ms, now).length >= perSender.max) return false;
  if (recent(byRecipient, perRecipient.ms, now).length >= perRecipient.max) return false;
  sweep(now);
  for (const key of perSender ? [bySender, byRecipient] : [byRecipient]) {
    sent.set(key, [...(sent.get(key) ?? []), now]);
  }
  return true;
}

/** For tests. */
export function resetEmailLimits(): void {
  sent.clear();
}

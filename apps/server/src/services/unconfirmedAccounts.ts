import { and, eq, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  commentThreads,
  comments,
  diagramSnapshots,
  diagrams,
  projects,
  users,
  workspaceMembers,
} from '../db/schema.js';
import { isMailEnabled } from './mailer.js';

/**
 * Anyone can type any address into the sign-up form, so an account whose
 * address was never confirmed may not be its owner's. One left unconfirmed
 * for a month, with nothing of its own, is removed: the address is free
 * for whoever signs up with it next. Only where the server sends
 * confirmation emails (elsewhere nobody could confirm), and never an account
 * with work in it (its owner can take it back with a password reset).
 */

export const UNCONFIRMED_ACCOUNT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A full sweep runs at most this often per server. */
const SWEEP_EVERY_MS = 60 * 60 * 1000;

export const unconfirmedCutoff = (now = Date.now()) =>
  new Date(now - UNCONFIRMED_ACCOUNT_DAYS * DAY_MS);

/** Never confirmed, older than the cutoff, and nothing anyone else would lose. */
function abandoned(cutoff: Date): SQL {
  const owns = [
    sql`select 1 from ${projects} where ${projects.ownerId} = ${users.id}`,
    sql`select 1 from ${workspaceMembers} where ${workspaceMembers.userId} = ${users.id}`,
    sql`select 1 from ${diagrams} where ${diagrams.createdBy} = ${users.id}`,
    sql`select 1 from ${diagramSnapshots} where ${diagramSnapshots.createdBy} = ${users.id}`,
    sql`select 1 from ${commentThreads} where ${commentThreads.createdBy} = ${users.id}`,
    sql`select 1 from ${comments} where ${comments.authorId} = ${users.id}`,
  ];
  return and(
    isNull(users.emailVerifiedAt),
    lt(users.createdAt, cutoff),
    ...owns.map((query) => sql`not exists (${query})`),
  )!;
}

/**
 * The address is held by an abandoned sign-up: remove it so the person
 * signing up now can have the address. True if one was removed.
 */
export async function releaseAbandonedAddress(email: string, now = Date.now()): Promise<boolean> {
  if (!isMailEnabled()) return false;
  const removed = await db
    .delete(users)
    .where(and(eq(users.email, email.toLowerCase()), abandoned(unconfirmedCutoff(now))))
    .returning({ id: users.id });
  return removed.length > 0;
}

let lastSweep = 0;

/** Remove every abandoned sign-up (at most hourly); returns how many went. */
export async function sweepAbandonedSignups(now = Date.now()): Promise<number> {
  if (!isMailEnabled() || now - lastSweep < SWEEP_EVERY_MS) return 0;
  lastSweep = now;
  const removed = await db
    .delete(users)
    .where(abandoned(unconfirmedCutoff(now)))
    .returning({ id: users.id });
  return removed.length;
}

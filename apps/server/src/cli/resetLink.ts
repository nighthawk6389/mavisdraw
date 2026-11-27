/**
 * A password reset link for an account, for whoever runs the server, when it
 * sends no email (or the person can't receive it):
 *
 *   docker compose exec api node apps/server/dist/cli/resetLink.js someone@example.com
 *
 * Send the link to the person yourself. It works once, for an hour, and
 * signs out every session of the account.
 */
import { createResetLinkFor } from '../services/passwordReset.js';
import { closeDb } from '../db/client.js';

const email = process.argv[2];
if (!email) {
  console.error('Usage: node apps/server/dist/cli/resetLink.js <email>');
  process.exit(2);
}
try {
  const link = await createResetLinkFor(email);
  if (!link) {
    console.error(`No account for ${email}`);
    process.exitCode = 1;
  } else {
    console.log(link);
  }
} finally {
  await closeDb();
}

import { config, type Config } from '../config.js';
import { reportError } from '../observability.js';

/**
 * Outgoing email. Providers are called over HTTPS (no SDKs): Resend or
 * Postmark in production; `log` prints messages in development; `outbox`
 * keeps them in memory for the end-to-end tests; `none` drops them.
 *
 * Sending never fails the request that triggered it: a missed email is
 * logged and reported, and the invite link is still shown in the app.
 */

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const outbox: Array<Email & { sentAt: string }> = [];

/** Messages "sent" with MAIL_PROVIDER=outbox (tests only). */
export function readOutbox(): ReadonlyArray<Email & { sentAt: string }> {
  return outbox;
}

export function isMailEnabled(mail: Config['mail'] = config.mail): boolean {
  return mail.provider !== 'none';
}

async function deliver(email: Email, mail: Config['mail']): Promise<void> {
  switch (mail.provider) {
    case 'none':
      return;
    case 'outbox':
      outbox.push({ ...email, sentAt: new Date().toISOString() });
      return;
    case 'log':
      console.log(`[mail] To: ${email.to}\n[mail] Subject: ${email.subject}\n${email.text}\n`);
      return;
    case 'resend': {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${mail.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: mail.from,
          to: [email.to],
          subject: email.subject,
          text: email.text,
          html: email.html,
        }),
      });
      if (!res.ok)
        throw new Error(`Resend responded ${res.status}: ${await res.text().catch(() => '')}`);
      return;
    }
    case 'postmark': {
      const res = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: {
          'X-Postmark-Server-Token': mail.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          From: mail.from,
          To: email.to,
          Subject: email.subject,
          TextBody: email.text,
          HtmlBody: email.html,
          MessageStream: 'outbound',
        }),
      });
      if (!res.ok)
        throw new Error(`Postmark responded ${res.status}: ${await res.text().catch(() => '')}`);
    }
  }
}

/** Send, never throwing. Resolves to whether it was handed to the provider. */
export async function sendMail(email: Email, mail: Config['mail'] = config.mail): Promise<boolean> {
  if (!isMailEnabled(mail)) return false;
  try {
    await deliver(email, mail);
    return true;
  } catch (err) {
    console.error('[mail] Failed to send:', err);
    reportError(err, { route: 'mail' });
    return false;
  }
}

// ── Templates ────────────────────────────────────────────────

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function layout(
  heading: string,
  body: string,
  cta: { label: string; url: string },
  footer: string,
): string {
  return `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2937">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="100%" style="max-width:520px;background:#fff;border:1px solid #e5e7eb;border-radius:12px" cellpadding="0" cellspacing="0">
<tr><td style="padding:28px">
<div style="font-weight:700;font-size:15px;color:#2563eb;margin-bottom:16px">MavisDraw</div>
<h1 style="font-size:18px;margin:0 0 12px">${heading}</h1>
<div style="font-size:14px;line-height:1.55;color:#374151">${body}</div>
<p style="margin:24px 0 8px"><a href="${escapeHtml(cta.url)}" style="background:#2563eb;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block">${escapeHtml(cta.label)}</a></p>
<p style="font-size:12px;color:#6b7280;word-break:break-all">Or open: ${escapeHtml(cta.url)}</p>
</td></tr></table>
<p style="font-size:12px;color:#9ca3af;max-width:520px">${footer}</p>
</td></tr></table></body></html>`;
}

const article = (kind: 'project' | 'workspace') =>
  kind === 'project' ? 'the project' : 'the workspace';

/** To someone without an account: join with this link (valid only for their address). */
export function inviteEmail(input: {
  to: string;
  inviterName: string;
  kind: 'project' | 'workspace';
  targetName: string;
  link: string;
}): Email {
  const subject = `${input.inviterName} invited you to ${input.targetName} on MavisDraw`;
  const text = `${input.inviterName} invited you to ${article(input.kind)} "${input.targetName}" on MavisDraw.

Accept the invitation (sign up with ${input.to}):
${input.link}

If you weren't expecting this, you can ignore this email.`;
  const html = layout(
    `${escapeHtml(input.inviterName)} invited you to ${escapeHtml(input.targetName)}`,
    `<p>You've been invited to ${article(input.kind)} <strong>${escapeHtml(input.targetName)}</strong> on MavisDraw — architecture diagrams you can zoom into.</p><p>Sign up with <strong>${escapeHtml(input.to)}</strong> to accept; the link only works for that address.</p>`,
    { label: 'Accept invitation', url: input.link },
    "If you weren't expecting this, you can ignore this email.",
  );
  return { to: input.to, subject, text, html };
}

/** To an existing user who was just given access. */
export function addedEmail(input: {
  to: string;
  inviterName: string;
  kind: 'project' | 'workspace';
  targetName: string;
  link: string;
}): Email {
  const subject = `${input.inviterName} added you to ${input.targetName}`;
  const text = `${input.inviterName} added you to ${article(input.kind)} "${input.targetName}" on MavisDraw.

Open it: ${input.link}`;
  const html = layout(
    `You now have access to ${escapeHtml(input.targetName)}`,
    `<p>${escapeHtml(input.inviterName)} added you to ${article(input.kind)} <strong>${escapeHtml(input.targetName)}</strong>.</p>`,
    { label: `Open ${input.kind}`, url: input.link },
    'You received this because someone shared MavisDraw work with you.',
  );
  return { to: input.to, subject, text, html };
}

/** To someone @mentioned in a comment. */
export function mentionEmail(input: {
  to: string;
  actorName: string;
  projectName: string;
  diagramTitle: string;
  excerpt: string;
  link: string;
}): Email {
  const subject = `${input.actorName} mentioned you in ${input.diagramTitle}`;
  const text = `${input.actorName} mentioned you in "${input.diagramTitle}" (${input.projectName}):

"${input.excerpt}"

Reply: ${input.link}`;
  const html = layout(
    `${escapeHtml(input.actorName)} mentioned you`,
    `<p>In <strong>${escapeHtml(input.diagramTitle)}</strong> · ${escapeHtml(input.projectName)}</p><blockquote style="margin:12px 0;padding:8px 12px;border-left:3px solid #e5e7eb;color:#4b5563">${escapeHtml(input.excerpt)}</blockquote>`,
    { label: 'Open the thread', url: input.link },
    'You received this because you were @mentioned on MavisDraw.',
  );
  return { to: input.to, subject, text, html };
}

import { describe, it, expect, vi, afterEach } from 'vitest';
import { addedEmail, inviteEmail, mentionEmail, readOutbox, sendMail } from '../services/mailer.js';

afterEach(() => vi.unstubAllGlobals());

const mail = (provider: 'resend' | 'postmark' | 'outbox' | 'none' | 'log') => ({
  provider,
  from: 'MavisDraw <n@example.com>',
  apiKey: 'key-123',
});

describe('email templates', () => {
  it('invite: who, what, and a link that only works for that address', () => {
    const e = inviteEmail({
      to: 'new@example.com',
      inviterName: 'Olivia',
      kind: 'project',
      targetName: 'Payments <Platform>',
      link: 'https://app.example.com/invite/tok',
    });
    expect(e.subject).toBe('Olivia invited you to Payments <Platform> on MavisDraw');
    expect(e.text).toContain('https://app.example.com/invite/tok');
    expect(e.text).toContain('new@example.com');
    // User-controlled text is escaped in HTML
    expect(e.html).toContain('Payments &lt;Platform&gt;');
    expect(e.html).not.toContain('<Platform>');
  });

  it('added and mention emails link to the right place', () => {
    expect(
      addedEmail({
        to: 'a@b.co',
        inviterName: 'O',
        kind: 'workspace',
        targetName: 'Acme',
        link: 'L',
      }).subject,
    ).toBe('O added you to Acme');
    const m = mentionEmail({
      to: 'a@b.co',
      actorName: 'Victor',
      projectName: 'Shop',
      diagramTitle: 'Checkout',
      excerpt: '<b>is this async?</b>',
      link: 'https://app/p/1/d/2?thread=3',
    });
    expect(m.subject).toBe('Victor mentioned you in Checkout');
    expect(m.html).toContain('&lt;b&gt;is this async?&lt;/b&gt;');
    expect(m.text).toContain('https://app/p/1/d/2?thread=3');
  });
});

describe('sending', () => {
  const email = { to: 'x@example.com', subject: 'Hi', text: 'Hello', html: '<p>Hello</p>' };

  it('Resend: one authenticated JSON call', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await sendMail(email, mail('resend'))).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer key-123');
    expect(JSON.parse(String(init.body))).toMatchObject({ to: ['x@example.com'], subject: 'Hi' });
  });

  it('Postmark: server token header and its field names', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await sendMail(email, mail('postmark'));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.postmarkapp.com/email');
    expect((init.headers as Record<string, string>)['X-Postmark-Server-Token']).toBe('key-123');
    expect(JSON.parse(String(init.body))).toMatchObject({ To: 'x@example.com', TextBody: 'Hello' });
  });

  it('a provider failure never throws to the caller', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 422 })),
    );
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(sendMail(email, mail('resend'))).resolves.toBe(false);
    errors.mockRestore();
  });

  it('outbox keeps messages for tests; none sends nothing', async () => {
    const before = readOutbox().length;
    expect(await sendMail(email, mail('outbox'))).toBe(true);
    expect(readOutbox()).toHaveLength(before + 1);
    expect(await sendMail(email, mail('none'))).toBe(false);
  });
});

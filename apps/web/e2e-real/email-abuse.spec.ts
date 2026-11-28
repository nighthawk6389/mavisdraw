import { test, expect, type APIRequestContext } from '@playwright/test';
import { addToProject, as, createProject, expectJson, signUp, uniq } from './api';
import { API_URL, waitForEmail, type SentEmail } from './helpers';

/**
 * Nobody can use this server to send mail in bulk: email others can trigger
 * (@mentions, invites) is capped, and strangers on a public project can't
 * make it email the project's people.
 */

async function outboxTo(request: APIRequestContext, to: string): Promise<SentEmail[]> {
  const res = await request.get(`${API_URL}/api/test/outbox`);
  const { messages } = (await res.json()) as { messages: SentEmail[] };
  return messages.filter((m) => m.to === to);
}

const pin = (body: string, mentions: string[]) => ({
  elementId: null,
  x: 100,
  y: 100,
  offsetX: 0,
  offsetY: 0,
  body,
  mentions,
});

test.describe('Email abuse', () => {
  test('a stranger on a public project can comment, but can’t make it email anyone', async ({
    request,
  }) => {
    const owner = await signUp(request, 'Owner');
    const member = await signUp(request, 'Member Mia');
    const stranger = await signUp(request, 'Stranger Sam');
    const project = await createProject(request, owner, `Public ${uniq()}`);
    await addToProject(request, owner, project.id, member, 'editor');
    await expectJson(
      as(request, owner).put(`/api/projects/${project.id}`, { isPublic: true }),
      200,
    );
    const d = project.rootDiagramId;

    // The stranger's @mention comes first, then a member's
    await expectJson(
      as(request, stranger).post(`/api/diagrams/${d}/comments`, pin('Buy now!', [owner.id])),
      201,
    );
    await expectJson(
      as(request, member).post(`/api/diagrams/${d}/comments`, pin('Can you check?', [owner.id])),
      201,
    );
    await waitForEmail(request, owner.email, /Member Mia mentioned you in /);
    const mail = await outboxTo(request, owner.email);
    expect(mail.some((m) => /Stranger Sam/.test(m.subject))).toBe(false);
  });

  test('one address gets a few invitations a day by email; then the inviter gets the link', async ({
    request,
  }) => {
    const target = `invitee-${uniq()}@e2e.mavisdraw.dev`;
    const results: Array<{ emailed: boolean; inviteUrl?: string }> = [];
    for (let i = 0; i < 6; i++) {
      const owner = await signUp(request, `Inviter ${i}`);
      const project = await createProject(request, owner, `Invites ${uniq()}`);
      results.push(
        await expectJson(
          as(request, owner).post(`/api/projects/${project.id}/invites`, {
            email: target,
            role: 'viewer',
          }),
          201,
        ),
      );
    }
    expect(results.map((r) => r.emailed)).toEqual([true, true, true, true, true, false]);
    // The sixth inviter still has a link to send themselves
    expect(results[5].inviteUrl).toMatch(/\/invite\//);
    await expect.poll(async () => (await outboxTo(request, target)).length).toBe(5);
  });

  test('one inbox gets only a few reset links a day, and mail never carries a stranger’s words', async ({
    request,
  }) => {
    const victim = await signUp(request, 'Locked Out');
    const resets = async () =>
      (await outboxTo(request, victim.email)).filter((m) =>
        /Reset your MavisDraw password/.test(m.subject),
      ).length;
    for (let i = 0; i < 8; i++) {
      const res = await request.post(`${API_URL}/api/auth/forgot-password`, {
        data: { email: victim.email },
      });
      expect(res.status()).toBe(200);
    }
    // Each answer comes after its email was handed over (or skipped)
    expect(await resets()).toBe(5);

    // Anyone can sign up with any address and any name: the confirmation
    // email doesn't repeat the name
    const email = `target-${uniq()}@e2e.mavisdraw.dev`;
    const res = await request.post(`${API_URL}/api/auth/register`, {
      data: { email, password: 'correct-horse-battery', name: 'Urgent: visit evil.example now' },
    });
    expect(res.status()).toBe(201);
    const sent = await waitForEmail(request, email, /Confirm your email/);
    expect(sent.text).not.toContain('evil.example');
    expect(sent.html).not.toContain('evil.example');
  });
});
